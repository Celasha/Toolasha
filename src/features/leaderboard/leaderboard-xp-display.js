/**
 * Leaderboard XP Display
 * Adds Last XP/h and Last day XP/h columns to the player Leaderboard panel.
 */

import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import config from '../../core/config.js';
import { leaderboardXPTracker } from './leaderboard-xp-tracker.js';
import { fNum, rankBadge, addColumn, makeColumnSortable } from '../../utils/table-columns.js';

const CSS_PREFIX = 'mwi-leaderboard-xp';

class LeaderboardXPDisplay {
    constructor() {
        this.initialized = false;
        this.unregisterObservers = [];
    }

    initialize() {
        if (this.initialized) return;
        if (!config.getSetting('leaderboardXPDisplay', true)) return;

        // Only process leaderboard tables that are NOT inside the Guild panel
        const unregLeaderboard = domObserver.onClass(
            'LeaderboardXPDisplay-Leaderboard',
            'LeaderboardPanel_leaderboardTable',
            (el) => {
                if (!el.closest('[class*="GuildPanel"]')) this._renderLeaderboard(el);
            }
        );
        this.unregisterObservers.push(unregLeaderboard);

        this._boundRefreshLeaderboard = (data) => {
            if (data?.leaderboardCategory !== 'guild') {
                this._refreshLeaderboardIfVisible(data?.leaderboardCategory);
            }
        };
        webSocketHook.on('leaderboard_updated', this._boundRefreshLeaderboard);
        this.unregisterObservers.push(() => webSocketHook.off('leaderboard_updated', this._boundRefreshLeaderboard));

        this.initialized = true;
    }

    _renderLeaderboard(tableEl, category) {
        if (tableEl.querySelector(`th.${CSS_PREFIX}`)) return;

        const resolvedCategory = category || leaderboardXPTracker.getLastLeaderboardCategory();

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
            const stats = name
                ? leaderboardXPTracker.getPlayerStats(name, resolvedCategory)
                : { lastXPH: 0, lastDayXPH: 0 };
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

    _refreshLeaderboardIfVisible(category) {
        const allTables = document.querySelectorAll('[class*="LeaderboardPanel_leaderboardTable"]');
        for (const tableEl of allTables) {
            if (!tableEl.closest('[class*="GuildPanel"]')) {
                tableEl.querySelectorAll(`th.${CSS_PREFIX}, td.${CSS_PREFIX}`).forEach((el) => el.remove());
                this._renderLeaderboard(tableEl, category);
            }
        }
    }

    disable() {
        for (const unregister of this.unregisterObservers) {
            unregister();
        }
        this.unregisterObservers = [];
        document.querySelectorAll(`.${CSS_PREFIX}`).forEach((el) => el.remove());
        this.initialized = false;
    }
}

const leaderboardXPDisplay = new LeaderboardXPDisplay();

export default {
    name: 'Leaderboard XP Display',
    initialize: () => leaderboardXPDisplay.initialize(),
    cleanup: () => leaderboardXPDisplay.disable(),
};
