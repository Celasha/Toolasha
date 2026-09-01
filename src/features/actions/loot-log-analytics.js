/**
 * Loot Log Analytics
 * Pure aggregation logic for the Loot & XP Log pivot table (current session + stored history).
 * No DOM/game-data access here - callers resolve names/icons/prices from the returned hrids.
 */

const EXCLUDED_XP_SKILL_HRID = '/skills/total_level';

/**
 * Real elapsed time for one loot log entry, matching the game's own Duration display:
 * totalActiveMillis (excludes offline/idle gaps) when present, else wall-clock startTime→endTime.
 * @param {Object} entry
 * @returns {number} milliseconds, or 0 if unresolvable
 */
function getEntryDurationMs(entry) {
    if (entry.totalActiveMillis > 0) return entry.totalActiveMillis;
    if (!entry.startTime || !entry.endTime) return 0;
    const ms = new Date(entry.endTime) - new Date(entry.startTime);
    return ms > 0 ? ms : 0;
}

/**
 * Union current-session and stored-history entries, deduplicated by characterActionId.
 * Current-session data wins on overlap, since it's the freshest source for entries still live.
 * @param {Array} currentEntries
 * @param {Array} historicalEntries
 * @returns {Array}
 */
function mergeCurrentAndHistoricalEntries(currentEntries, historicalEntries) {
    const seen = new Map();
    for (const entry of historicalEntries || []) {
        if (entry?.characterActionId != null) seen.set(entry.characterActionId, entry);
    }
    for (const entry of currentEntries || []) {
        if (entry?.characterActionId != null) seen.set(entry.characterActionId, entry);
    }
    return Array.from(seen.values());
}

/**
 * Grouping key for the pivot table: same action, kept separate per difficulty tier so e.g.
 * different dungeon tiers never get merged into one row.
 * @param {Object} entry
 * @returns {string}
 */
function buildActionGroupKey(entry) {
    return `${entry.actionHrid}::${entry.difficultyTier ?? ''}`;
}

/**
 * Group loot log entries by action (+ difficulty tier) and sum time/actions/drops/XP.
 * Enhancement actions are excluded, matching the rest of the Loot Log Stats feature.
 * @param {Array} entries
 * @returns {Array<Object>} one row per distinct action/tier combination
 */
function aggregatePivotRows(entries) {
    const rows = new Map();

    for (const entry of entries || []) {
        if (!entry?.actionHrid) continue;
        if (entry.actionHrid === '/actions/enhancing/enhance') continue;

        const key = buildActionGroupKey(entry);
        let row = rows.get(key);
        if (!row) {
            row = {
                actionHrid: entry.actionHrid,
                difficultyTier: entry.difficultyTier ?? null,
                entryCount: 0,
                actionCount: 0,
                totalTimeMs: 0,
                drops: {},
                xpGains: {},
                earliestStartMs: null,
                latestEndMs: null,
            };
            rows.set(key, row);
        }

        row.entryCount += 1;
        row.actionCount += entry.actionCount || 0;
        row.totalTimeMs += getEntryDurationMs(entry);

        for (const [dropHrid, count] of Object.entries(entry.drops || {})) {
            row.drops[dropHrid] = (row.drops[dropHrid] || 0) + count;
        }

        for (const [skillHrid, amount] of Object.entries(entry.xpGains || {})) {
            if (skillHrid === EXCLUDED_XP_SKILL_HRID) continue;
            row.xpGains[skillHrid] = (row.xpGains[skillHrid] || 0) + amount;
        }

        if (entry.startTime) {
            const startMs = new Date(entry.startTime).getTime();
            if (!Number.isNaN(startMs) && (row.earliestStartMs == null || startMs < row.earliestStartMs)) {
                row.earliestStartMs = startMs;
            }
        }
        if (entry.endTime) {
            const endMs = new Date(entry.endTime).getTime();
            if (!Number.isNaN(endMs) && (row.latestEndMs == null || endMs > row.latestEndMs)) {
                row.latestEndMs = endMs;
            }
        }
    }

    return Array.from(rows.values());
}

export {
    EXCLUDED_XP_SKILL_HRID,
    getEntryDurationMs,
    mergeCurrentAndHistoricalEntries,
    buildActionGroupKey,
    aggregatePivotRows,
};
