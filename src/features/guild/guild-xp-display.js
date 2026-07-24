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
import { formatDateTime } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { fNum, rankBadge, addColumn, makeColumnSortable } from '../../utils/table-columns.js';

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
            style="height: ${heightPct}%; width: ${widthPct}%; border-right: 1px solid var(--color-space-700); box-sizing: border-box; ${bgStyle}"
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
            <div style="font-size: 10px; width: 80px; transform: ${labelTransform};">${formatDateTime(new Date(d.t), { includeSeconds: false })}</div>
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
            <div style="flex: 1 1; display: flex; align-items: flex-end; height: 100%;">
                ${barsHTML}
            </div>
            <div></div>
            <div></div>
            <div style="flex: 0 0; position: relative; height: 28px; overflow: visible;">
                ${legendHTML}
            </div>
        </div>`;
}

// ─── Display class ──────────────────────────────────────────────────────────

class GuildXPDisplay {
    constructor() {
        this.initialized = false;
        this.unregisterObservers = [];
        this.timerRegistry = createTimerRegistry();
        this._activityCellCache = {};
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

        // Watch for guild leaderboard tab (only process tables inside GuildPanel)
        const unregLeaderboard = domObserver.onClass(
            'GuildXPDisplay-Leaderboard',
            'LeaderboardPanel_leaderboardTable',
            (el) => {
                if (el.closest('[class*="GuildPanel"]')) this._renderGuildLeaderboard(el);
            }
        );
        this.unregisterObservers.push(unregLeaderboard);

        const unregTrials = domObserver.onClass('GuildXPDisplay-Trials', 'GuildPanel_trialsContent', (el) =>
            this._renderTrialSignups(el)
        );
        this.unregisterObservers.push(unregTrials);

        // Live refresh on data updates
        this._boundRefreshOverview = () => this._refreshOverviewIfVisible();
        this._boundRefreshMembers = () => this._refreshMembersIfVisible();
        this._boundRefreshTrials = () => {
            const el = document.querySelector('[class*="GuildPanel_trialsContent"]');
            if (el) this._renderTrialSignups(el);
        };
        this._boundRefreshLeaderboard = (data) => {
            if (data?.leaderboardCategory === 'guild') this._refreshGuildLeaderboardIfVisible();
        };

        webSocketHook.on('guild_updated', this._boundRefreshOverview);
        webSocketHook.on('guild_characters_updated', this._boundRefreshMembers);
        webSocketHook.on('guild_characters_updated', this._boundRefreshTrials);
        webSocketHook.on('guild_updated', this._boundRefreshTrials);
        webSocketHook.on('guild_trial_signup_updated', this._boundRefreshTrials);
        webSocketHook.on('leaderboard_updated', this._boundRefreshLeaderboard);

        this.unregisterObservers.push(() => {
            webSocketHook.off('guild_updated', this._boundRefreshOverview);
            webSocketHook.off('guild_characters_updated', this._boundRefreshMembers);
            webSocketHook.off('guild_characters_updated', this._boundRefreshTrials);
            webSocketHook.off('guild_updated', this._boundRefreshTrials);
            webSocketHook.off('guild_trial_signup_updated', this._boundRefreshTrials);
            webSocketHook.off('leaderboard_updated', this._boundRefreshLeaderboard);
        });

        this.initialized = true;

        // Intercept clicks on Weekly XP column before React's string sort fires.
        // Uses document-level capturing so we run before React's delegated handler.
        // Identifies the column by its stable CSS class (not textContent, which changes
        // when the user switches between Status and Contributions tabs on the same DOM element).
        this._weeklyXPSortDir = 'desc';
        this._weeklyXPClickHandler = (e) => {
            const th = e.target.closest('[class*="GuildPanel_weeklyExperience"]');
            if (!th) return;
            e.stopPropagation();
            e.stopImmediatePropagation();

            const table = th.closest('table');
            if (!table) return;
            const thead = table.querySelector('thead tr');
            if (!thead) return;
            const colIdx = Array.from(thead.children).indexOf(th);
            const tbody = table.querySelector('tbody');
            if (!tbody || colIdx < 0) return;

            this._weeklyXPSortDir = this._weeklyXPSortDir === 'desc' ? 'asc' : 'desc';
            const dir = this._weeklyXPSortDir;

            const rows = Array.from(tbody.children);
            rows.sort((a, b) => {
                const av = this._parseWeeklyXP(a.children[colIdx]?.textContent?.trim() || '');
                const bv = this._parseWeeklyXP(b.children[colIdx]?.textContent?.trim() || '');
                return dir === 'asc' ? av - bv : bv - av;
            });
            for (const row of rows) tbody.appendChild(row);
        };
        document.addEventListener('click', this._weeklyXPClickHandler, true);
        this.unregisterObservers.push(() => document.removeEventListener('click', this._weeklyXPClickHandler, true));
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
        // Skip if already injected
        if (tableEl.querySelector(`.${CSS_PREFIX}`)) return;

        // Set up a tab-switch observer once per table element.
        // React reuses the same DOM element across the Status/Contributions tabs,
        // updating header text in place. We detect that by watching the thead for
        // changes to game-owned headers, then re-inject our columns for the new view.
        if (!tableEl._mwiTabObserver) {
            const theadTrEl = tableEl.querySelector('thead tr');
            if (theadTrEl) {
                const getGameHeaders = () =>
                    Array.from(theadTrEl.children)
                        .filter((th) => !th.classList.contains(CSS_PREFIX))
                        .map((th) => th.textContent.trim())
                        .join('|');
                let lastHeaders = getGameHeaders();

                const obs = new MutationObserver(() => {
                    const cur = getGameHeaders();
                    if (cur === lastHeaders) return;
                    lastHeaders = cur;
                    tableEl.querySelectorAll(`.${CSS_PREFIX}`).forEach((el) => el.remove());
                    setTimeout(() => {
                        this._injectMembersColumns(tableEl);
                        this._highlightMembersRows(tableEl);
                    }, 50);
                });
                obs.observe(theadTrEl, { childList: true, subtree: true, characterData: true });
                tableEl._mwiTabObserver = obs;
                this.unregisterObservers.push(() => obs.disconnect());
            }
        }

        this._injectMembersColumns(tableEl);
        this._highlightMembersRows(tableEl);
    }

    _injectMembersColumns(tableEl) {
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
                inactiveTime: meta?.inactiveTime || null,
                isOnline: meta?.isOnline || false,
                hideOnlineStatus: meta?.hideOnlineStatus || false,
            });
        }

        // Compute rankings
        const byLastXPH = allStats.slice().sort((a, b) => b.lastXPH - a.lastXPH);
        const byLastDayXPH = allStats.slice().sort((a, b) => b.lastDayXPH - a.lastDayXPH);
        for (let i = 0; i < byLastXPH.length; i++) byLastXPH[i].lastXPH_rank = i + 1;
        for (let i = 0; i < byLastDayXPH.length; i++) byLastDayXPH[i].lastDayXPH_rank = i + 1;

        const theadTr = tableEl.querySelector('thead tr');
        if (!theadTr) return;

        // Find Activity column index — its presence indicates the Status tab.
        const activityIndex = Array.from(theadTr.children).findIndex((el) => el.textContent.trim() === 'Activity');
        const isStatusTab = activityIndex >= 0;
        const insertAfter = theadTr.children.length - 1;

        const gameModes = { standard: 'MC', ironcow: 'IC', legacy_ironcow: 'LC' };
        const showGameMode = config.getSetting('guildMembersShowGameMode', false);
        const showJoined = config.getSetting('guildMembersShowJoined', true);
        const showLastXPH = config.getSetting('guildMembersShowLastXPH', true);
        const showLastDayXPH = config.getSetting('guildMembersShowLastDayXPH', true);
        const activityTab = config.getSettingValue('guildMembersActivityTab', 'contributions');

        // Joined column — Status tab only
        if (isStatusTab) {
            // Snapshot the game's native Activity cell HTML for each member so we can
            // replay it verbatim on the Contributions tab (sprites, "Xd ago" text, etc.)
            const activityColIdx = activityIndex;
            for (const row of rows) {
                const name = row.children[0]?.textContent?.trim();
                const cell = row.children[activityColIdx];
                if (name && cell) {
                    this._activityCellCache[name] = cell.innerHTML;
                }
            }

            let styleEl = document.getElementById('mwi-guild-activity-hide');
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'mwi-guild-activity-hide';
                document.head.appendChild(styleEl);
            }
            if (activityTab === 'contributions') {
                styleEl.textContent = `
                    [class*="GuildPanel_activity"] { display: none !important; }`;
            } else {
                styleEl.textContent = '';
            }

            if (showGameMode) {
                addColumn(tableEl, CSS_PREFIX, {
                    name: 'Game Mode',
                    insertAfter,
                    data: allStats.map((s) => s.gameMode),
                    format: (v) => gameModes[v] || v || '',
                    makeSortable: true,
                    sortId: 'gameMode',
                    sortData: allStats.map((s) => s.gameMode || ''),
                });
            }

            if (showJoined) {
                addColumn(tableEl, CSS_PREFIX, {
                    name: 'Joined',
                    insertAfter,
                    data: allStats.map((s) => s.joinTime),
                    format: (v) =>
                        v
                            ? `<span style="white-space: nowrap;">${formatDateTime(new Date(v), { includeTime: false, includeYear: true })}</span>`
                            : '',
                    makeSortable: true,
                    sortId: 'joinTime',
                    sortData: allStats.map((s) => (s.joinTime ? +new Date(s.joinTime) : 0)),
                });
            }
            return;
        }

        // Contributions tab columns
        let colOffset = 0;

        if (showLastXPH) {
            addColumn(tableEl, CSS_PREFIX, {
                name: 'Last XP/h',
                insertAfter: insertAfter + colOffset,
                data: allStats.map((s) => s.lastXPH),
                format: (v, i) => {
                    if (!v || v <= 0) return '';
                    return `${fNum(v)} ${rankBadge(allStats[i].lastXPH_rank)}`;
                },
                makeSortable: true,
                sortId: 'lastXPH',
                sortData: allStats.map((s) => s.lastXPH),
            });
            colOffset++;
        }

        // Last day XP/h column — Contributions tab
        if (showLastDayXPH) {
            addColumn(tableEl, CSS_PREFIX, {
                name: 'Last day XP/h',
                insertAfter: insertAfter + colOffset,
                data: allStats.map((s) => s.lastDayXPH),
                format: (v, i) => {
                    if (!v || v <= 0) return '';
                    return `${fNum(v)} ${rankBadge(allStats[i].lastDayXPH_rank)}`;
                },
                makeSortable: true,
                sortId: 'lastDayXPH',
                sortData: allStats.map((s) => s.lastDayXPH),
            });
            colOffset++;
        }

        // Activity column — Contributions tab (uses cached HTML from game's Status tab render)
        if (activityTab !== 'status') {
            addColumn(tableEl, CSS_PREFIX, {
                name: 'Activity',
                insertAfter: insertAfter + colOffset,
                data: allStats.map((s) => ({
                    cached: this._activityCellCache[s.name] ?? null,
                    inactiveTime: s.inactiveTime,
                    isOnline: s.isOnline,
                    hide: s.hideOnlineStatus,
                })),
                format: (v) => {
                    if (v.cached !== null) return v.cached;
                    // Fallback: text-based when Status tab hasn't been visited this session
                    if (v.hide) return '–';
                    if (v.isOnline) return '<span style="color:#4ade80; font-size:14px;" title="Online">●</span>';
                    if (!v.inactiveTime) return '–';
                    const ms = Date.now() - new Date(v.inactiveTime).getTime();
                    const days = Math.floor(ms / 86400000);
                    const hours = Math.floor(ms / 3600000);
                    const mins = Math.floor(ms / 60000);
                    if (days > 0) return `${days}d ago`;
                    if (hours > 0) return `${hours}h ago`;
                    return mins > 0 ? `${mins}m ago` : 'just now';
                },
                makeSortable: true,
                sortId: 'activityTime',
                sortData: allStats.map((s) => {
                    if (s.hideOnlineStatus) return Infinity;
                    if (s.isOnline) return 0;
                    if (!s.inactiveTime) return Infinity;
                    return Date.now() - new Date(s.inactiveTime).getTime();
                }),
            });
        }

        // Make existing columns sortable
        const nameHeader = theadTr.children[0];
        if (nameHeader && !nameHeader.querySelector('.mwi-col-sort-icon')) {
            makeColumnSortable(nameHeader, {
                sortId: 'name',
                valueGetter: (trEl) => trEl.children[0]?.textContent?.trim() || '',
            });
        }

        // Guild Exp column
        const expHeader = Array.from(theadTr.children).find((el) => el.textContent.includes('Guild Exp'));
        if (expHeader && !expHeader.querySelector('.mwi-col-sort-icon')) {
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
        if (roleHeader && !roleHeader.querySelector('.mwi-col-sort-icon')) {
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
        if (activityHeader && !activityHeader.querySelector('.mwi-col-sort-icon')) {
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
        if (statusHeader && !statusHeader.querySelector('.mwi-col-sort-icon')) {
            const statusColIndex = Array.from(theadTr.children).indexOf(statusHeader);
            makeColumnSortable(statusHeader, {
                sortId: 'status',
                valueGetter: (trEl) => {
                    const text = trEl.children[statusColIndex]?.textContent?.trim() || '';
                    return text === 'Online' ? 0 : 1;
                },
            });
        }

        // Weekly XP numeric sort is handled by a document-level capturing interceptor
        // in initialize() — see _weeklyXPClickHandler.
    }

    _highlightMembersRows(tableEl) {
        const tbodyEl = tableEl.querySelector('tbody');
        if (!tbodyEl) return;
        const rows = Array.from(tbodyEl.children);
        const theadTr = tableEl.querySelector('thead tr');

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

        // Highlight inactive players using whichever Activity column is present
        // (game's on Status tab, or our injected one on Contributions tab)
        const activityHeader =
            theadTr && Array.from(theadTr.children).find((el) => el.textContent.trim() === 'Activity');
        if (activityHeader) {
            const actColIndex = Array.from(theadTr.children).indexOf(activityHeader);
            for (const row of rows) {
                if (selfName && row.children[0]?.textContent?.trim() === selfName) continue;
                const cell = row.children[actColIndex];
                if (!cell) continue;
                const text = cell.textContent?.trim() || '';
                const daysMatch = text.match(/(\d+)d\s*ago/);
                if (daysMatch) {
                    const days = parseInt(daysMatch[1], 10);
                    row.style.backgroundColor = days >= 10 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(251, 146, 60, 0.12)';
                }
            }
        }
    }

    _refreshMembersIfVisible() {
        // Members tab re-renders fully on data change, so DOM observer will re-fire.
        // No explicit refresh needed.
    }

    // ─── Trials tab ──────────────────────────────────────────────────────────

    _renderTrialSignups(trialsContentEl) {
        if (!config.getSetting('guildTrialSignupDisplay', true)) return;

        // Remove previous injection
        trialsContentEl.querySelectorAll('.mwi-trial-signups').forEach((el) => el.remove());

        const memberList = guildXPTracker.getMemberList();
        if (!memberList.length) return;

        const currentWeek = guildXPTracker.getCurrentWeekStartAt();
        const unsignedSkilling = [];
        const unsignedCombat = [];

        for (const member of memberList) {
            const meta = guildXPTracker.getMemberMeta(member.characterID);
            if (!meta) continue;

            // Members who joined after this week's reset are ineligible until next week
            if (currentWeek && meta.joinTime && new Date(meta.joinTime) >= new Date(currentWeek)) continue;

            const signedUpThisWeek = currentWeek && meta.signupWeekStartAt === currentWeek;

            if (!signedUpThisWeek || !meta.signedUpSkillingTrialHrid) {
                unsignedSkilling.push(meta.name);
            }
            if (!signedUpThisWeek || !meta.signedUpCombatTrialHrid) {
                unsignedCombat.push(meta.name);
            }
        }

        unsignedSkilling.sort((a, b) => a.localeCompare(b));
        unsignedCombat.sort((a, b) => a.localeCompare(b));

        const statusRow = trialsContentEl.querySelector('[class*="GuildPanel_eventStatusRow"]');
        if (!statusRow) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'mwi-trial-signups';
        wrapper.style.cssText = `
            margin: 8px 0 4px;
            padding: 8px 12px;
            background: rgba(0,0,0,0.25);
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.6;
        `;

        const makeList = (label, names) => {
            const color = names.length === 0 ? '#4ade80' : '#f0a830';
            const nameStr =
                names.length === 0
                    ? 'All signed up ✓'
                    : names
                          .map(
                              (n) =>
                                  `<span class="mwi-trial-name" data-name="${n}" style="cursor:pointer; text-decoration:underline dotted; color:${color};">${n}</span>`
                          )
                          .join('<span style="color:#6b7280;">, </span>');
            return `<div><span style="color:#9ca3af;">${label} (${names.length} unsigned):</span> <span style="color:${color};">${nameStr}</span></div>`;
        };

        wrapper.innerHTML = makeList('Skilling', unsignedSkilling) + makeList('Combat', unsignedCombat);

        statusRow.insertAdjacentElement('afterend', wrapper);

        wrapper.querySelectorAll('.mwi-trial-name').forEach((el) => {
            el.addEventListener('click', () => {
                const name = el.dataset.name;
                const chatInput = document.querySelector('[class*="Chat_chatInputContainer"] input');
                if (!chatInput) return;
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                const DEFAULT_TEMPLATE = "/w {name} Why haven't you signed up for your trial(s) yet?!";
                let template =
                    config.getSettingValue('guildTrialWhisperTemplate', DEFAULT_TEMPLATE) || DEFAULT_TEMPLATE;
                if (Array.isArray(template)) {
                    template = template
                        .map((item) => (item.type === 'variable' ? item.key : (item.value ?? '')))
                        .join('');
                }
                setter.call(chatInput, String(template).replace('{name}', name));
                chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                chatInput.focus();
            });
        });
    }

    /**
     * Parse a Weekly XP cell value, handling K (thousands) and M (millions) suffixes.
     * @param {string} raw
     * @returns {number}
     */
    _parseWeeklyXP(raw) {
        const m = raw.match(/^([\d,.]+)(K|M)?$/i);
        if (!m) return 0;
        const num = parseFloat(m[1].replace(/,/g, ''));
        const mult = m[2]?.toUpperCase() === 'M' ? 1_000_000 : m[2]?.toUpperCase() === 'K' ? 1_000 : 1;
        return num * mult;
    }

    // ─── Guild Leaderboard tab ───────────────────────────────────────────────

    _renderGuildLeaderboard(tableEl) {
        if (tableEl.querySelector(`th.${CSS_PREFIX}`)) return;

        const allHistories = guildXPTracker.getAllGuildHistories();
        if (!allHistories || Object.keys(allHistories).length === 0) return;

        const containerEl = tableEl.closest('[class*="LeaderboardPanel_content"]');
        if (containerEl) containerEl.style.maxWidth = '1000px';

        const tbodyEl = tableEl.querySelector('tbody');
        if (!tbodyEl) return;

        const rows = Array.from(tbodyEl.children);
        const theadTr = tableEl.querySelector('thead tr');
        if (!theadTr) return;

        const allStats = [];
        for (const row of rows) {
            const name = row.children[1]?.textContent?.trim();
            const stats = name ? guildXPTracker.getGuildStats(name) : { lastXPH: 0, lastDayXPH: 0 };
            allStats.push({ name, lastXPH: stats.lastXPH, lastDayXPH: stats.lastDayXPH });
        }

        const byLastXPH = allStats.slice().sort((a, b) => b.lastXPH - a.lastXPH);
        const byLastDayXPH = allStats.slice().sort((a, b) => b.lastDayXPH - a.lastDayXPH);
        for (let i = 0; i < byLastXPH.length; i++) byLastXPH[i].lastXPH_rank = i + 1;
        for (let i = 0; i < byLastDayXPH.length; i++) byLastDayXPH[i].lastDayXPH_rank = i + 1;

        const insertAfter = theadTr.children.length - 1;

        addColumn(tableEl, CSS_PREFIX, {
            name: 'Last XP/h',
            insertAfter,
            data: allStats.map((s) => s.lastXPH),
            format: (v, i) => (!v || v <= 0 ? '' : `${fNum(v)} ${rankBadge(allStats[i].lastXPH_rank)}`),
            makeSortable: true,
            sortId: 'lastXPH',
            skipFirst: true,
            sortData: allStats.map((s) => s.lastXPH),
        });

        addColumn(tableEl, CSS_PREFIX, {
            name: 'Last day XP/h',
            insertAfter: insertAfter + 1,
            data: allStats.map((s) => s.lastDayXPH),
            format: (v, i) => (!v || v <= 0 ? '' : `${fNum(v)} ${rankBadge(allStats[i].lastDayXPH_rank)}`),
            makeSortable: true,
            sortId: 'lastDayXPH',
            skipFirst: true,
            sortData: allStats.map((s) => s.lastDayXPH),
        });

        const rankHeader = Array.from(theadTr.children).find((el) => el.textContent.trim() === 'Rank');
        if (rankHeader && !rankHeader.querySelector('.mwi-col-sort-icon')) {
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

    _refreshGuildLeaderboardIfVisible() {
        const tableEl = document.querySelector('[class*="GuildPanel"] [class*="LeaderboardPanel_leaderboardTable"]');
        if (tableEl) {
            tableEl.querySelectorAll(`th.${CSS_PREFIX}, td.${CSS_PREFIX}`).forEach((el) => el.remove());
            this._renderGuildLeaderboard(tableEl);
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
                        <span>${formatDateTime(new Date(t), { includeSeconds: false })}</span>
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
        document.getElementById('mwi-guild-activity-hide')?.remove();

        this.initialized = false;
    }
}

const guildXPDisplay = new GuildXPDisplay();

export default {
    name: 'Guild XP Display',
    initialize: () => guildXPDisplay.initialize(),
    cleanup: () => guildXPDisplay.disable(),
};
