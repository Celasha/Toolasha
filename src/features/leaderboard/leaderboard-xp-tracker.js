/**
 * Leaderboard XP Tracker
 * Records player XP over time from leaderboard WebSocket messages.
 * Stores history in IndexedDB for XP/hr rate calculations on the Leaderboard panel.
 *
 * Data sources:
 * - leaderboard_updated (non-guild categories) — XP for players on leaderboard
 */

import webSocketHook from '../../core/websocket.js';
import storage from '../../core/storage.js';
import config from '../../core/config.js';

const STORE_NAME = 'leaderboardHistory';
const WINDOW_10M = 10 * 60 * 1000;
const WINDOW_1H = 60 * 60 * 1000;
const WINDOW_1D = 24 * 60 * 60 * 1000;
const WINDOW_1W = 7 * 24 * 60 * 60 * 1000;

// ─── History compaction helpers ──────────────────────────────────────────────

function pushXP(arr, d) {
    if (arr.length === 0 || d.xp >= arr[arr.length - 1].xp) {
        arr.push(d);
    } else {
        return;
    }

    if (arr.length <= 2) return;

    let recentLength = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (d.t - arr[i].t <= WINDOW_10M) {
            recentLength++;
        } else {
            break;
        }
    }
    if (recentLength > 2) {
        arr.splice(arr.length - recentLength + 1, recentLength - 2);
    }

    let sameLength = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].xp === d.xp && d.t - arr[i].t <= WINDOW_1H) {
            sameLength++;
        } else {
            break;
        }
    }
    if (sameLength > 1) {
        arr.splice(arr.length - sameLength, sameLength - 1);
    }

    let oldLength = 0;
    for (let i = 0; i < arr.length; i++) {
        if (d.t - arr[i].t > WINDOW_1W) {
            oldLength++;
        } else {
            break;
        }
    }
    if (oldLength > 0) {
        arr.splice(0, oldLength);
    }
}

function inLastInterval(arr, interval) {
    const now = Date.now();
    const result = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        if (now - arr[i].t <= interval) {
            result.unshift(arr[i]);
        } else {
            break;
        }
    }
    return result;
}

function calcXPH(prev, cur) {
    const tDeltaMs = cur.t - prev.t;
    if (tDeltaMs <= 0) return 0;
    return ((cur.xp - prev.xp) / tDeltaMs) * 3600000;
}

function calcStats(arr) {
    const empty = { lastXPH: 0, lastHourXPH: 0, lastDayXPH: 0 };
    if (!arr || arr.length < 2) return empty;

    const lastXPH = calcXPH(arr[arr.length - 2], arr[arr.length - 1]);

    const last1h = inLastInterval(arr, WINDOW_1H);
    const lastHourXPH = last1h.length >= 2 ? calcXPH(last1h[0], last1h[last1h.length - 1]) : 0;

    const last1d = inLastInterval(arr, WINDOW_1D);
    const lastDayXPH = last1d.length >= 2 ? calcXPH(last1d[0], last1d[last1d.length - 1]) : 0;

    return { lastXPH, lastHourXPH, lastDayXPH };
}

// ─── Tracker class ──────────────────────────────────────────────────────────

class LeaderboardXPTracker {
    constructor() {
        this.initialized = false;
        this.playerXPHistory = {}; // `${category}_${playerName}` → [{t, xp}]
        this.lastLeaderboardCategory = null;
        this.unregisterHandlers = [];
    }

    async initialize() {
        if (this.initialized) return;
        if (!config.getSetting('leaderboardXPTracker', true)) return;

        // Load history BEFORE registering WS listener to avoid race condition where
        // leaderboard_updated arrives before storage resolves, causing history to be overwritten.
        this.playerXPHistory = await storage.get('playerXP', STORE_NAME, {});

        this._boundOnLeaderboardUpdated = (data) => this._onLeaderboardUpdated(data);
        webSocketHook.on('leaderboard_updated', this._boundOnLeaderboardUpdated);
        this.unregisterHandlers.push(() => webSocketHook.off('leaderboard_updated', this._boundOnLeaderboardUpdated));

        this.initialized = true;
    }

    /**
     * Handle leaderboard_updated — record player XP for non-guild leaderboard categories.
     * @param {Object} data - leaderboard_updated message
     */
    _onLeaderboardUpdated(data) {
        if (data.leaderboardCategory === 'guild') return;

        const rows = data.leaderboard?.rows;
        if (!rows || rows.length === 0) return;

        const t = Date.now();
        this.lastLeaderboardCategory = data.leaderboardCategory;
        let changed = false;

        for (const row of rows) {
            const name = row.name;
            const xp = row.value2;
            if (!name || xp === undefined) continue;

            const key = `${data.leaderboardCategory}_${name}`;
            if (!this.playerXPHistory[key]) {
                this.playerXPHistory[key] = [];
            }
            const history = this.playerXPHistory[key];
            // Only record when XP changes — repeated same-XP navigations would otherwise
            // extend the time window without changing the delta, causing rates to decay.
            if (history.length === 0 || history[history.length - 1].xp !== xp) {
                pushXP(history, { t, xp });
                changed = true;
            }
        }

        if (changed) {
            storage.set('playerXP', this.playerXPHistory, STORE_NAME);
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * Get XP/hr stats for a player on the leaderboard.
     * @param {string} playerName
     * @param {string} category - Leaderboard category (e.g. 'foraging', 'enhancing')
     * @returns {{lastXPH: number, lastHourXPH: number, lastDayXPH: number}}
     */
    getPlayerStats(playerName, category) {
        const key = `${category}_${playerName}`;
        return calcStats(this.playerXPHistory[key]);
    }

    /**
     * Get the most recently seen leaderboard category.
     * @returns {string|null}
     */
    getLastLeaderboardCategory() {
        return this.lastLeaderboardCategory;
    }

    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];
        this.playerXPHistory = {};
        this.lastLeaderboardCategory = null;
        this.initialized = false;
    }
}

const leaderboardXPTracker = new LeaderboardXPTracker();

export default {
    name: 'Leaderboard XP Tracker',
    initialize: () => leaderboardXPTracker.initialize(),
    cleanup: () => leaderboardXPTracker.disable(),
};

export { leaderboardXPTracker };
