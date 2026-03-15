/**
 * Guild XP Tracker
 * Records guild-level and per-member XP over time via WebSocket messages.
 * Stores history in IndexedDB for XP/hr rate calculations.
 *
 * Data sources:
 * - character_initialized (via dataManager) — initial snapshot on login
 * - guild_updated — guild total XP changes
 * - guild_characters_updated — per-member XP changes
 * - leaderboard_updated (category: guild) — XP for all guilds on leaderboard
 */

import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import storage from '../../core/storage.js';
import config from '../../core/config.js';

const STORE_NAME = 'guildHistory';
const WINDOW_10M = 10 * 60 * 1000;
const WINDOW_1H = 60 * 60 * 1000;
const WINDOW_1D = 24 * 60 * 60 * 1000;
const WINDOW_1W = 7 * 24 * 60 * 60 * 1000;

/**
 * Guild level experience table (same thresholds as skill levels).
 * Hardcoded because initClientData may not expose guild-specific thresholds.
 */
const LEVEL_EXPERIENCE_TABLE = [
    0, 33, 76, 132, 202, 286, 386, 503, 637, 791, 964, 1159, 1377, 1620, 1891, 2192, 2525, 2893, 3300, 3750, 4247, 4795,
    5400, 6068, 6805, 7618, 8517, 9508, 10604, 11814, 13151, 14629, 16262, 18068, 20064, 22271, 24712, 27411, 30396,
    33697, 37346, 41381, 45842, 50773, 56222, 62243, 68895, 76242, 84355, 93311, 103195, 114100, 126127, 139390, 154009,
    170118, 187863, 207403, 228914, 252584, 278623, 307256, 338731, 373318, 411311, 453030, 498824, 549074, 604193,
    664632, 730881, 803472, 882985, 970050, 1065351, 1169633, 1283701, 1408433, 1544780, 1693774, 1856536, 2034279,
    2228321, 2440088, 2671127, 2923113, 3197861, 3497335, 3823663, 4179145, 4566274, 4987741, 5446463, 5945587, 6488521,
    7078945, 7720834, 8418485, 9176537, 10000000, 11404976, 12904567, 14514400, 16242080, 18095702, 20083886, 22215808,
    24501230, 26950540, 29574787, 32385721, 35395838, 38618420, 42067584, 45758332, 49706603, 53929328, 58444489,
    63271179, 68429670, 73941479, 79829440, 86117783, 92832214, 100000000, 114406130, 130118394, 147319656, 166147618,
    186752428, 209297771, 233962072, 260939787, 290442814, 322702028, 357968938, 396517495, 438646053, 484679494,
    534971538, 589907252, 649905763, 715423218, 786955977, 865044093, 950275074, 1043287971, 1144777804, 1255500373,
    1376277458, 1508002470, 1651646566, 1808265285, 1979005730, 2165114358, 2367945418, 2588970089, 2829786381,
    3092129857, 3377885250, 3689099031, 4027993033, 4396979184, 4798675471, 5235923207, 5711805728, 6229668624,
    6793141628, 7406162301, 8073001662, 8798291902, 9587056372, 10444742007, 11377254401, 12390995728, 13492905745,
    14690506120, 15991948361, 17406065609, 18942428633, 20611406335, 22424231139, 24393069640, 26531098945, 28852589138,
    31372992363, 34109039054, 37078841860, 40302007875, 43799759843, 47595067021, 51712786465, 56179815564, 61025256696,
    66280594953, 71979889960, 78159982881, 84860719814, 92125192822, 100000000000,
];

// ─── History compaction helpers ──────────────────────────────────────────────
// Same compaction rules as src/features/skills/xp-tracker.js

/**
 * Append an XP data point to a history array, compacting as needed.
 * @param {Array} arr - Existing history array (mutated in place)
 * @param {{t: number, xp: number}} d - New data point
 */
function pushXP(arr, d) {
    if (arr.length === 0 || d.xp >= arr[arr.length - 1].xp) {
        arr.push(d);
    } else {
        return; // XP should never decrease
    }

    if (arr.length <= 2) return;

    // Rule 1: within the last 10 minutes, keep only first + last
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

    // Rule 2: collapse consecutive same-XP entries within 1 hour
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

    // Rule 3: drop entries older than 1 week
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

/**
 * Filter history to entries within a time interval from now.
 * @param {Array} arr - History array
 * @param {number} interval - Window in ms
 * @returns {Array}
 */
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

/**
 * Keep at most one entry per interval (for chart resolution).
 * @param {Array} arr - History array
 * @param {number} interval - Minimum gap between kept entries
 * @returns {Array}
 */
function keepOneInInterval(arr, interval) {
    const filtered = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        if (filtered.length === 0) {
            filtered.unshift(arr[i]);
        } else if (filtered[0].t - arr[i].t >= interval) {
            filtered.unshift(arr[i]);
        } else if (i === 0) {
            filtered.unshift(arr[i]);
        }
    }
    return filtered;
}

/**
 * Calculate XP/hr between two data points.
 * @param {{t: number, xp: number}} prev
 * @param {{t: number, xp: number}} cur
 * @returns {number} XP per hour
 */
function calcXPH(prev, cur) {
    const tDeltaMs = cur.t - prev.t;
    if (tDeltaMs <= 0) return 0;
    return ((cur.xp - prev.xp) / tDeltaMs) * 3600000;
}

// ─── Stats calculation ──────────────────────────────────────────────────────

/**
 * Compute XP/hr stats for a history array.
 * @param {Array} arr - [{t, xp}, ...]
 * @returns {{lastXPH: number, lastHourXPH: number, lastDayXPH: number, chart: Array}}
 */
function calcStats(arr) {
    const empty = { lastXPH: 0, lastHourXPH: 0, lastDayXPH: 0, chart: [] };
    if (!arr || arr.length < 2) return empty;

    // Last XP/h (between last two entries)
    const lastXPH = calcXPH(arr[arr.length - 2], arr[arr.length - 1]);

    // Last hour XP/h
    const last1h = inLastInterval(arr, WINDOW_1H);
    const lastHourXPH = last1h.length >= 2 ? calcXPH(last1h[0], last1h[last1h.length - 1]) : 0;

    // Last day XP/h
    const last1d = inLastInterval(arr, WINDOW_1D);
    const lastDayXPH = last1d.length >= 2 ? calcXPH(last1d[0], last1d[last1d.length - 1]) : 0;

    // Chart: weekly data at 10m resolution
    const last1w = inLastInterval(arr, WINDOW_1W);
    const chartData = keepOneInInterval(last1w, WINDOW_10M);
    const chart = [];
    for (let i = 1; i < chartData.length; i++) {
        const prev = chartData[i - 1];
        const cur = chartData[i];
        chart.push({
            t: cur.t,
            tD: cur.t - prev.t,
            xpH: calcXPH(prev, cur),
        });
    }

    return { lastXPH, lastHourXPH, lastDayXPH, chart };
}

/**
 * Calculate time to next guild level.
 * @param {number} currentXP - Current guild XP
 * @param {number} xpPerHour - Current XP/hr rate
 * @returns {number|null} Milliseconds to next level, or null if cannot calculate
 */
function calcTimeToLevel(currentXP, xpPerHour) {
    if (xpPerHour <= 0) return null;

    const nextLvlIndex = LEVEL_EXPERIENCE_TABLE.findIndex((xp) => currentXP <= xp);
    if (nextLvlIndex < 0) return null;

    const xpTillLevel = LEVEL_EXPERIENCE_TABLE[nextLvlIndex] - currentXP;
    if (xpTillLevel <= 0) return null;

    return (xpTillLevel / xpPerHour) * 3600000;
}

// ─── Tracker class ──────────────────────────────────────────────────────────

class GuildXPTracker {
    constructor() {
        this.initialized = false;
        this.ownGuildName = null;
        this.ownGuildID = null;
        this.guildCreatedAt = null;
        this.guildXPHistory = {}; // guildName → [{t, xp}]
        this.memberXPHistory = {}; // characterID → [{t, xp}]
        this.memberMeta = {}; // characterID → {name, gameMode, joinTime, invitedBy}
        this.unregisterHandlers = [];
    }

    async initialize() {
        if (this.initialized) return;
        if (!config.getSetting('guildXPTracker', true)) return;

        // Bind handlers
        this._boundOnCharacterInit = (data) => this._onCharacterInit(data);
        this._boundOnGuildUpdated = (data) => this._onGuildUpdated(data);
        this._boundOnMembersUpdated = (data) => this._onMembersUpdated(data);
        this._boundOnLeaderboardUpdated = (data) => this._onLeaderboardUpdated(data);

        // Register dataManager listener for init data
        dataManager.on('character_initialized', this._boundOnCharacterInit);
        this.unregisterHandlers.push(() => dataManager.off('character_initialized', this._boundOnCharacterInit));

        // Register WebSocket listeners
        webSocketHook.on('guild_updated', this._boundOnGuildUpdated);
        webSocketHook.on('guild_characters_updated', this._boundOnMembersUpdated);
        webSocketHook.on('leaderboard_updated', this._boundOnLeaderboardUpdated);
        this.unregisterHandlers.push(() => {
            webSocketHook.off('guild_updated', this._boundOnGuildUpdated);
            webSocketHook.off('guild_characters_updated', this._boundOnMembersUpdated);
            webSocketHook.off('leaderboard_updated', this._boundOnLeaderboardUpdated);
        });

        // If character data already loaded, initialize immediately
        if (dataManager.characterData) {
            await this._onCharacterInit(dataManager.characterData);
        }

        this.initialized = true;
    }

    /**
     * Handle character initialization — load persisted history and record initial snapshot.
     * @param {Object} data - Full init_character_data message
     */
    async _onCharacterInit(data) {
        const guild = data.guild;
        if (!guild) return; // Player not in a guild

        const guildName = guild.name;
        const guildXP = guild.experience;
        this.ownGuildName = guildName;
        this.guildCreatedAt = guild.createdAt;

        // Extract guild ID and member metadata
        const guildCharacterMap = data.guildCharacterMap || {};
        const sharableMap = data.guildSharableCharacterMap || {};

        const charIds = Object.keys(guildCharacterMap);
        if (charIds.length > 0) {
            this.ownGuildID = guildCharacterMap[charIds[0]].guildID;
        }

        // Build member metadata
        this.memberMeta = {};
        for (const [charId, sharableData] of Object.entries(sharableMap)) {
            const guildChar = guildCharacterMap[charId];
            const inviterId = guildChar?.inviterCharacterID;
            this.memberMeta[charId] = {
                name: sharableData.name,
                gameMode: sharableData.gameMode,
                joinTime: guildChar?.joinTime || null,
                invitedBy: sharableMap[inviterId]?.name || null,
            };
        }

        // Load persisted histories
        this.guildXPHistory = await storage.get(`guildXP_${guildName}`, STORE_NAME, {});
        if (this.ownGuildID) {
            this.memberXPHistory = await storage.get(`memberXP_${this.ownGuildID}`, STORE_NAME, {});
        }

        const t = data.currentTimestamp ? +new Date(data.currentTimestamp) : Date.now();

        // Record guild XP snapshot
        if (!this.guildXPHistory[guildName]) {
            this.guildXPHistory[guildName] = [];
        }
        pushXP(this.guildXPHistory[guildName], { t, xp: guildXP });

        // Record member XP snapshots
        for (const [charId, guildChar] of Object.entries(guildCharacterMap)) {
            if (!this.memberXPHistory[charId]) {
                this.memberXPHistory[charId] = [];
            }
            pushXP(this.memberXPHistory[charId], { t, xp: guildChar.guildExperience });
        }

        // Persist
        await storage.set(`guildXP_${guildName}`, this.guildXPHistory, STORE_NAME);
        if (this.ownGuildID) {
            await storage.set(`memberXP_${this.ownGuildID}`, this.memberXPHistory, STORE_NAME);
        }
    }

    /**
     * Handle guild_updated — record guild-level XP.
     * @param {Object} data - guild_updated message
     */
    _onGuildUpdated(data) {
        const guild = data.guild;
        if (!guild) return;

        const name = guild.name;
        this.ownGuildName = name;
        this.guildCreatedAt = guild.createdAt;

        if (!this.guildXPHistory[name]) {
            this.guildXPHistory[name] = [];
        }

        const t = Date.now();
        pushXP(this.guildXPHistory[name], { t, xp: guild.experience });
        storage.set(`guildXP_${name}`, this.guildXPHistory, STORE_NAME);
    }

    /**
     * Handle guild_characters_updated — record per-member XP.
     * @param {Object} data - guild_characters_updated message
     */
    _onMembersUpdated(data) {
        const guildCharacterMap = data.guildCharacterMap || {};
        const sharableMap = data.guildSharableCharacterMap || {};

        // Update guild ID
        const charIds = Object.keys(guildCharacterMap);
        if (charIds.length > 0) {
            this.ownGuildID = guildCharacterMap[charIds[0]].guildID;
        }

        // Update member metadata
        for (const [charId, sharableData] of Object.entries(sharableMap)) {
            const guildChar = guildCharacterMap[charId];
            const inviterId = guildChar?.inviterCharacterID;
            this.memberMeta[charId] = {
                name: sharableData.name,
                gameMode: sharableData.gameMode,
                joinTime: guildChar?.joinTime || null,
                invitedBy: sharableMap[inviterId]?.name || null,
            };
        }

        const t = Date.now();

        for (const [charId, guildChar] of Object.entries(guildCharacterMap)) {
            if (!this.memberXPHistory[charId]) {
                this.memberXPHistory[charId] = [];
            }
            pushXP(this.memberXPHistory[charId], { t, xp: guildChar.guildExperience });
        }

        if (this.ownGuildID) {
            storage.set(`memberXP_${this.ownGuildID}`, this.memberXPHistory, STORE_NAME);
        }
    }

    /**
     * Handle leaderboard_updated — record XP for all guilds on leaderboard.
     * @param {Object} data - leaderboard_updated message
     */
    _onLeaderboardUpdated(data) {
        if (data.leaderboardCategory !== 'guild') return;

        const rows = data.leaderboard?.rows;
        if (!rows || rows.length === 0) return;

        const t = Date.now();

        for (const row of rows) {
            const name = row.name;
            const xp = row.value2;
            if (!name || xp === undefined) continue;

            if (!this.guildXPHistory[name]) {
                this.guildXPHistory[name] = [];
            }
            pushXP(this.guildXPHistory[name], { t, xp });
        }

        // Persist using own guild name as key (all guild histories stored together)
        if (this.ownGuildName) {
            storage.set(`guildXP_${this.ownGuildName}`, this.guildXPHistory, STORE_NAME);
        }
    }

    // ─── Public API (for display module) ─────────────────────────────────────

    /**
     * Get XP/hr stats for a guild.
     * @param {string} guildName
     * @returns {{lastXPH: number, lastHourXPH: number, lastDayXPH: number, chart: Array}}
     */
    getGuildStats(guildName) {
        return calcStats(this.guildXPHistory[guildName]);
    }

    /**
     * Get XP/hr stats for a guild member.
     * @param {string} characterID
     * @returns {{lastXPH: number, lastHourXPH: number, lastDayXPH: number, chart: Array}}
     */
    getMemberStats(characterID) {
        return calcStats(this.memberXPHistory[characterID]);
    }

    /**
     * Get metadata for a guild member.
     * @param {string} characterID
     * @returns {{name: string, gameMode: string, joinTime: string, invitedBy: string}|null}
     */
    getMemberMeta(characterID) {
        return this.memberMeta[characterID] || null;
    }

    /**
     * Get own guild name.
     * @returns {string|null}
     */
    getOwnGuildName() {
        return this.ownGuildName;
    }

    /**
     * Get own guild ID.
     * @returns {string|null}
     */
    getOwnGuildID() {
        return this.ownGuildID;
    }

    /**
     * Get guild creation date.
     * @returns {string|null}
     */
    getGuildCreatedAt() {
        return this.guildCreatedAt;
    }

    /**
     * Get member list with IDs.
     * @returns {Array<{characterID: string, name: string, gameMode: string, joinTime: string, invitedBy: string}>}
     */
    getMemberList() {
        return Object.entries(this.memberMeta).map(([charId, meta]) => ({
            characterID: charId,
            ...meta,
        }));
    }

    /**
     * Get all guild XP histories (for leaderboard stats).
     * @returns {Object} guildName → [{t, xp}]
     */
    getAllGuildHistories() {
        return this.guildXPHistory;
    }

    /**
     * Get current guild XP (latest recorded value).
     * @param {string} guildName
     * @returns {number|null}
     */
    getCurrentGuildXP(guildName) {
        const history = this.guildXPHistory[guildName];
        if (!history || history.length === 0) return null;
        return history[history.length - 1].xp;
    }

    /**
     * Get latest member XP.
     * @param {string} characterID
     * @returns {number|null}
     */
    getMemberXP(characterID) {
        const history = this.memberXPHistory[characterID];
        if (!history || history.length === 0) return null;
        return history[history.length - 1].xp;
    }

    /**
     * Calculate time to next guild level.
     * @param {string} guildName
     * @returns {number|null} Milliseconds, or null
     */
    getTimeToLevel(guildName) {
        const currentXP = this.getCurrentGuildXP(guildName);
        if (currentXP === null) return null;

        const stats = this.getGuildStats(guildName);
        const rate = stats.lastDayXPH > 0 ? stats.lastDayXPH : stats.lastXPH;
        return calcTimeToLevel(currentXP, rate);
    }

    /**
     * Cleanup when disabled.
     */
    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];

        this.ownGuildName = null;
        this.ownGuildID = null;
        this.guildCreatedAt = null;
        this.guildXPHistory = {};
        this.memberXPHistory = {};
        this.memberMeta = {};
        this.initialized = false;
    }
}

const guildXPTracker = new GuildXPTracker();

export default {
    name: 'Guild XP Tracker',
    initialize: () => guildXPTracker.initialize(),
    cleanup: () => guildXPTracker.disable(),
};

export { guildXPTracker };
