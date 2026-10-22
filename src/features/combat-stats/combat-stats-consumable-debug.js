/**
 * Combat Stats Consumable Diagnostics
 * Temporary, in-memory diagnostics for the current player's consumable tracking (issue #803).
 * Counts the same consumption three independent ways - accepted `battle_consumable_ability_updated`
 * events, count drops between consecutive event payloads, and count drops between consecutive
 * `new_battle` snapshots - plus the connection/reset context, so a gap between the self row and
 * the real consumption can be attributed. Nothing here is persisted or shown in the UI; it is
 * read from the browser console via `toolashaConsumableDebug()`.
 */

const MAX_LOG_ENTRIES = 50;

function createItemStats() {
    return {
        eventsAccepted: 0,
        eventsDedupSkipped: 0,
        payloadCountDrop: 0,
        payloadMissedEvents: 0,
        snapshotDrop: 0,
        snapshotLargeDropIgnored: 0,
        firstSnapshotCount: null,
        lastSnapshotCount: null,
        lastPayloadCount: null,
        gapCredited: 0,
        gapRejected: 0,
        gapRejectedAmount: 0,
        gapRestocks: 0,
    };
}

class ConsumableDebugRecorder {
    constructor() {
        this.reset();
    }

    reset() {
        this.recordedSince = Date.now();
        this.items = {};
        this.newBattleMessages = 0;
        this.longestNewBattleGapMs = 0;
        this.newBattleGapsOver60s = 0;
        this.lastNewBattleAt = null;
        this.socketCloses = [];
        this.trackingResets = [];
        this.unobservedGaps = [];
    }

    _item(itemHrid) {
        if (!this.items[itemHrid]) this.items[itemHrid] = createItemStats();
        return this.items[itemHrid];
    }

    /**
     * @param {string} itemHrid
     * @param {boolean} accepted - False when the 100 ms duplicate filter dropped the event
     * @param {number|undefined} payloadCount - Remaining count carried by the event
     */
    recordEvent(itemHrid, accepted, payloadCount) {
        const item = this._item(itemHrid);
        if (!accepted) {
            item.eventsDedupSkipped++;
            return;
        }
        item.eventsAccepted++;
        if (typeof payloadCount === 'number') {
            if (typeof item.lastPayloadCount === 'number' && payloadCount < item.lastPayloadCount) {
                const drop = item.lastPayloadCount - payloadCount;
                item.payloadCountDrop += drop;
                // Each event is one consumption, so a drop of N > 1 means N - 1 events never arrived
                if (drop > 1) item.payloadMissedEvents += drop - 1;
            }
            item.lastPayloadCount = payloadCount;
        }
    }

    /**
     * @param {Array<{itemHrid: string, count: number}>} consumables - Current player's combatConsumables
     * @param {number} [now]
     */
    recordNewBattle(consumables, now = Date.now()) {
        this.newBattleMessages++;
        if (this.lastNewBattleAt !== null) {
            const gap = now - this.lastNewBattleAt;
            this.longestNewBattleGapMs = Math.max(this.longestNewBattleGapMs, gap);
            if (gap > 60000) this.newBattleGapsOver60s++;
        }
        this.lastNewBattleAt = now;

        for (const consumable of consumables || []) {
            if (!consumable?.itemHrid || typeof consumable.count !== 'number') continue;
            const item = this._item(consumable.itemHrid);
            if (item.firstSnapshotCount === null) item.firstSnapshotCount = consumable.count;
            if (typeof item.lastSnapshotCount === 'number' && consumable.count < item.lastSnapshotCount) {
                const drop = item.lastSnapshotCount - consumable.count;
                // Same 1-5 window the party-member tracking accepts
                if (drop <= 5) item.snapshotDrop += drop;
                else item.snapshotLargeDropIgnored++;
            }
            item.lastSnapshotCount = consumable.count;
        }
    }

    /**
     * Record the outcome of one snapshot reconciliation for the current player.
     * @param {{unobserved: boolean, excludeSeconds: number, items: Array<{itemHrid: string, action: string, credited: number, missed: number}>}} result
     * @param {number|null} gapSeconds
     * @param {number} [now]
     */
    recordReconcile(result, gapSeconds, now = Date.now()) {
        for (const entry of result.items) {
            const item = this._item(entry.itemHrid);
            if (entry.action === 'credit') item.gapCredited += entry.credited;
            else if (entry.action === 'reject') {
                item.gapRejected++;
                item.gapRejectedAmount += entry.missed;
            } else if (entry.action === 'restock') item.gapRestocks++;
        }
        if (result.unobserved) {
            this.unobservedGaps.push({
                at: new Date(now).toISOString(),
                gapSeconds: Math.round(gapSeconds),
                excludedSeconds: Math.round(result.excludeSeconds),
                items: result.items
                    .filter((entry) => entry.action !== 'none')
                    .map((entry) => `${entry.itemHrid}:${entry.action}:${entry.missed}`),
            });
            if (this.unobservedGaps.length > MAX_LOG_ENTRIES) this.unobservedGaps.shift();
        }
    }

    recordSocketClose(now = Date.now()) {
        this.socketCloses.push(new Date(now).toISOString());
        if (this.socketCloses.length > MAX_LOG_ENTRIES) this.socketCloses.shift();
    }

    recordTrackingReset(reason, now = Date.now()) {
        this.trackingResets.push({ at: new Date(now).toISOString(), reason });
        if (this.trackingResets.length > MAX_LOG_ENTRIES) this.trackingResets.shift();
    }

    /**
     * @param {Object} context - Values owned by the collector, merged into the report
     * @returns {Object} Plain JSON-serialisable report
     */
    getReport(context = {}) {
        const now = Date.now();
        return {
            note: 'Issue #803 diagnostics. In-memory only; resets when the page reloads.',
            generatedAt: new Date(now).toISOString(),
            recordedSince: new Date(this.recordedSince).toISOString(),
            recordedHours: Number(((now - this.recordedSince) / 3600000).toFixed(2)),
            newBattleMessages: this.newBattleMessages,
            longestNewBattleGapSeconds: Math.round(this.longestNewBattleGapMs / 1000),
            newBattleGapsOver60s: this.newBattleGapsOver60s,
            socketCloses: this.socketCloses,
            trackingResets: this.trackingResets,
            unobservedGaps: this.unobservedGaps,
            items: this.items,
            ...context,
        };
    }
}

const consumableDebugRecorder = new ConsumableDebugRecorder();

export default consumableDebugRecorder;
export { ConsumableDebugRecorder };
