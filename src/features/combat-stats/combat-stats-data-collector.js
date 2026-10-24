/**
 * Combat Statistics Data Collector
 * Listens for new_battle WebSocket messages and stores combat data
 */

import webSocketHook from '../../core/websocket.js';
import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';
import { calculateLevelGapDebuff, calculateCombatLevelFromLevelFields } from '../combat-sim/combat-sim-adapter.js';
import dungeonTracker from '../combat/dungeon-tracker.js';
import ExpectedLootTracker from './expected-loot-tracker.js';
import consumableDebugRecorder from './combat-stats-consumable-debug.js';
import { diagLog } from './combat-stats-diag-log.js';
import {
    reconcileSnapshot,
    wavesElapsed,
    estimateFightingSeconds,
    UNOBSERVED_GAP_SECONDS,
} from './consumable-reconcile.js';

const COMBAT_STATS_STORE = 'combatStats';
const LEGACY_STORAGE_KEYS = Object.freeze({
    consumableTracker: 'consumableTracker',
    partyConsumableTrackers: 'partyConsumableTrackers',
    partyConsumableSnapshots: 'partyConsumableSnapshots',
    latestCombatRun: 'latestCombatRun',
});
const STORAGE_MISSING = Symbol('storage-missing');
const CONSUMABLE_DEBUG_GLOBAL = 'toolashaConsumableDebug';

/** The page window, so the console can reach the diagnostics function from a userscript sandbox. */
function getPageWindow() {
    if (typeof unsafeWindow !== 'undefined') return unsafeWindow;
    return typeof window !== 'undefined' ? window : null;
}

/**
 * Derive a player's raw (unfloored) Combat Level from the seven whole skill-level fields on
 * their live `combatDetails`, for the SERVER-CONFIRMED Level Malus mechanic input (see
 * `calculateLevelGapDebuff()`'s doc comment in combat-sim-adapter.js). Returns null - never a
 * silent fallback to the floored `combatDetails.combatLevel` - if any required field is missing,
 * so a momentarily-incomplete payload skips the debuff calculation instead of feeding it wrong
 * data.
 * @param {Object} player - One player entry from a new_battle message
 * @returns {number|null} Raw combat level, or null if the required fields aren't present
 */
function getRawCombatLevel(player) {
    const cd = player?.combatDetails;
    const fields = {
        staminaLevel: cd?.staminaLevel,
        intelligenceLevel: cd?.intelligenceLevel,
        attackLevel: cd?.attackLevel,
        defenseLevel: cd?.defenseLevel,
        meleeLevel: cd?.meleeLevel,
        rangedLevel: cd?.rangedLevel,
        magicLevel: cd?.magicLevel,
    };
    if (Object.values(fields).some((v) => typeof v !== 'number')) return null;
    return calculateCombatLevelFromLevelFields(fields);
}

/**
 * Sum a `totalLootMap`-shaped object by real item HRID. The map's own object keys are opaque
 * composite strings (`{characterId}::{itemLocationHrid}::{itemHrid}::{enhancementLevel}`), NOT
 * the item HRID itself - the real HRID lives on each entry's own `.itemHrid` field, exactly like
 * `calculateIncome()` already reads it in `combat-stats-calculator.js`.
 * @param {Object} lootMap - `totalLootMap`-shaped object
 * @returns {Object} Map of itemHrid -> total count
 */
function sumLootByItemHrid(lootMap) {
    const totals = {};
    for (const loot of Object.values(lootMap || {})) {
        if (!loot?.itemHrid) continue;
        totals[loot.itemHrid] = (totals[loot.itemHrid] || 0) + loot.count;
    }
    return totals;
}

class CombatStatsDataCollector {
    constructor() {
        this.isInitialized = false;
        this.newBattleHandler = null;
        this.consumableEventHandler = null;
        this.latestCombatData = null;
        this.currentBattleId = null;
        this.characterId = null;
        this.lifecycleGeneration = 0;
        this.pendingEncounter = null;
        this.latestSelfCombatDropQuantity = 0;
        this.actualLootSnapshot = null;
        this.trackedZoneKey = null;
        this.runLuckSnapshot = null;
        this.expectedLootTracker = new ExpectedLootTracker();
        this.dungeonCompletionHandler = null;
        this.socketCloseHandler = null;
        this.connectionInterrupted = false;

        this._resetTrackingState();
    }

    _createConsumableTracker(startTime = null) {
        return {
            actualConsumed: {},
            defaultConsumed: {},
            inventoryAmount: {},
            startTime,
            lastUpdate: null,
            lastEventByItem: {},
            // Reconciliation state (issue #803): time we deliberately leave out of the rate, the last
            // time any message about this tracker arrived, and the run position for wave counting
            excludedMs: 0,
            lastObservedAt: null,
            runKey: null,
            lastBattleId: null,
            lastWave: null,
            lastBattleAt: null,
            waveIntervalSum: 0,
            waveIntervalCount: 0,
        };
    }

    _resetTrackingState(startTime = null) {
        this.consumableTracker = this._createConsumableTracker(startTime);
        this.partyConsumableTrackers = {};
        this.partyConsumableSnapshots = {};
        this.partyLastKnownConsumables = {};
        this.connectionInterrupted = false;
    }

    _getStorageKey(baseKey, characterId = this.characterId) {
        return characterId ? `${baseKey}:${characterId}` : baseKey;
    }

    async _loadCharacterScopedValue(baseKey, defaultValue, characterId = this.characterId) {
        const scopedKey = this._getStorageKey(baseKey, characterId);
        if (scopedKey === baseKey) {
            return storage.getJSON(baseKey, COMBAT_STATS_STORE, defaultValue);
        }

        const scoped = await storage.getJSON(scopedKey, COMBAT_STATS_STORE, STORAGE_MISSING);
        if (scoped !== STORAGE_MISSING) return scoped;

        const legacy = await storage.getJSON(baseKey, COMBAT_STATS_STORE, STORAGE_MISSING);
        if (legacy === STORAGE_MISSING) return defaultValue;

        await storage.setJSON(scopedKey, legacy, COMBAT_STATS_STORE, true);
        await storage.delete(baseKey, COMBAT_STATS_STORE);
        return legacy;
    }

    /**
     * Initialize the data collector
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;
        this.characterId = dataManager.getCurrentCharacterId();
        const generation = ++this.lifecycleGeneration;

        // Load only the active character's persisted tracking state.
        await this.loadConsumableTracking(this.characterId);
        if (generation !== this.lifecycleGeneration || !this.isInitialized) return;

        // Store handler references for cleanup
        this.newBattleHandler = (data) => this.onNewBattle(data, generation);
        this.consumableEventHandler = (data) => this.onConsumableUsed(data, generation);

        // Listen for new_battle messages (fires during combat, continuously updated)
        webSocketHook.on('new_battle', this.newBattleHandler);

        // Listen for battle_consumable_ability_updated (fires on each consumable use)
        webSocketHook.on('battle_consumable_ability_updated', this.consumableEventHandler);

        // A mid-session disconnect means some events during the gap may have been missed - flag
        // the current session's numbers as possibly incomplete rather than silently trusting them.
        this.socketCloseHandler = () => {
            if (generation !== this.lifecycleGeneration) return;
            consumableDebugRecorder.recordSocketClose();
            if (this.consumableTracker.startTime) {
                this.connectionInterrupted = true;
            }
        };
        webSocketHook.onSocketEvent('close', this.socketCloseHandler);

        // Reuse dungeon-tracker's own proven completion signal instead of re-deriving one
        this.dungeonCompletionHandler = (_current, completedRun) => {
            if (generation !== this.lifecycleGeneration) return;
            if (completedRun) {
                this.expectedLootTracker.recordDungeonCompletion({
                    zoneHrid: completedRun.dungeonHrid,
                    difficultyTier: completedRun.tier || 0,
                    numberOfPlayers: Object.keys(completedRun.keyCountsMap || {}).length || 1,
                    combatDropQuantity: this.latestSelfCombatDropQuantity,
                });
            }
        };
        dungeonTracker.onUpdate(this.dungeonCompletionHandler);

        const pageWindow = getPageWindow();
        if (pageWindow) pageWindow[CONSUMABLE_DEBUG_GLOBAL] = () => this.getConsumableDebugReport();
    }

    /**
     * Get game-theoretical maximum consumption rate per day for an item
     * Based on cooldown floors: drinks 300s / 1.2 max concentration, food 60s flat
     * @param {string} itemHrid - Item HRID
     * @returns {number} Max consumptions per day
     */
    getMaxRatePerDay(itemHrid) {
        const name = itemHrid.toLowerCase();
        if (name.includes('coffee') || name.includes('drink')) {
            return 345.6; // 300s / (1 + 0.20 max drink concentration) = 250s cooldown
        }
        return 1440; // 60s food cooldown
    }

    /**
     * Max waves of a dungeon from game data.
     * @param {string} zoneHrid - Combat action HRID
     * @returns {number|null}
     */
    getDungeonMaxWaves(zoneHrid) {
        return dataManager.getActionDetails(zoneHrid)?.combatZoneInfo?.dungeonInfo?.maxWaves || null;
    }

    /**
     * Estimate how long the character was actually fighting since the previous new_battle, from the
     * wave count and the run's average wave time. Null when it cannot be derived.
     * @param {Object} data - new_battle message data
     * @returns {number|null} Seconds
     */
    estimateGapFightingSeconds(data) {
        const tracker = this.consumableTracker;
        const zone = this.getCurrentZoneInfo();
        let dungeonMaxWaves = null;
        if (zone?.isDungeon) {
            dungeonMaxWaves = this.getDungeonMaxWaves(zone.zoneHrid);
            // Without the dungeon's wave count the run counter cannot be turned into waves
            if (!dungeonMaxWaves) return null;
        }

        const waves = wavesElapsed({
            previousBattleId: tracker.lastBattleId,
            previousWave: tracker.lastWave,
            battleId: data.battleId || 0,
            wave: typeof data.wave === 'number' ? data.wave : null,
            dungeonMaxWaves,
        });
        return estimateFightingSeconds(waves, {
            sum: tracker.waveIntervalSum,
            count: tracker.waveIntervalCount,
        });
    }

    /**
     * Record this message's run position and, for ordinary intervals, feed the average wave time.
     * @param {Object} data - new_battle message data
     * @param {number} now - Timestamp (ms)
     */
    updateRunPosition(data, now) {
        const tracker = this.consumableTracker;
        if (tracker.lastBattleAt) {
            const intervalSeconds = (now - tracker.lastBattleAt) / 1000;
            if (intervalSeconds > 0 && intervalSeconds <= UNOBSERVED_GAP_SECONDS) {
                tracker.waveIntervalSum += intervalSeconds;
                tracker.waveIntervalCount++;
            }
        }
        tracker.lastBattleAt = now;
        tracker.lastBattleId = data.battleId || 0;
        tracker.lastWave = typeof data.wave === 'number' ? data.wave : null;
        if (data.combatStartTime) tracker.runKey = data.combatStartTime;
    }

    /**
     * Apply a reconciliation result to a tracker: credit recovered consumption and drop the
     * unobserved part of the gap from its time base.
     * @param {Object} tracker - Self or party tracker
     * @param {{excludeSeconds: number, items: Array<{itemHrid: string, action: string, credited: number}>}} result
     * @param {number} now - Timestamp (ms)
     */
    applyReconciliation(tracker, result, now) {
        for (const entry of result.items) {
            if (entry.action !== 'credit') continue;
            // Recovered consumption before any event started the clock: start it where we last looked
            if (!tracker.startTime) tracker.startTime = tracker.lastObservedAt || now;
            if (tracker.actualConsumed[entry.itemHrid] === undefined) {
                tracker.actualConsumed[entry.itemHrid] = 0;
                tracker.defaultConsumed[entry.itemHrid] = this.getDefaultConsumed(entry.itemHrid);
            }
            tracker.actualConsumed[entry.itemHrid] += entry.credited;
            tracker.lastUpdate = now;
        }
        tracker.excludedMs = (tracker.excludedMs || 0) + Math.round(result.excludeSeconds * 1000);
        tracker.lastObservedAt = now;
    }

    /**
     * Reconcile the current player's consumables against this new_battle snapshot.
     * @param {Object|undefined} selfPlayer - The current player's entry in the new_battle payload
     * @param {number|null} fightingSeconds - Estimated fighting time in the gap
     * @param {number} now - Timestamp (ms)
     */
    reconcileSelfConsumables(selfPlayer, fightingSeconds, now) {
        const tracker = this.consumableTracker;
        const consumables = (selfPlayer?.combatConsumables || []).filter(
            (consumable) => consumable?.itemHrid && typeof consumable.count === 'number'
        );
        if (consumables.length === 0) return;

        const gapSeconds = tracker.lastObservedAt != null ? (now - tracker.lastObservedAt) / 1000 : null;
        const result = reconcileSnapshot({
            items: consumables.map((consumable) => ({
                itemHrid: consumable.itemHrid,
                lastKnown: tracker.inventoryAmount[consumable.itemHrid],
                snapshot: consumable.count,
                maxRatePerSecond: this.getMaxRatePerDay(consumable.itemHrid) / 86400,
            })),
            gapSeconds,
            fightingSeconds,
        });
        this.applyReconciliation(tracker, result, now);
        consumableDebugRecorder.recordReconcile(result, gapSeconds, now);
        this.logReconciliation('self', result, gapSeconds, fightingSeconds);
    }

    /**
     * Reconcile a party member's consumables against this new_battle snapshot.
     * @param {Object} tracker - The member's tracker
     * @param {Object} snapshots - The member's previous counts by item HRID
     * @param {Object} player - The member's entry in the new_battle payload
     * @param {number|null} fightingSeconds - Estimated fighting time in the gap
     * @param {number} now - Timestamp (ms)
     */
    reconcilePartyConsumables(tracker, snapshots, player, fightingSeconds, now) {
        const consumables = (player.combatConsumables || []).filter(
            (consumable) => consumable?.itemHrid && typeof consumable.count === 'number'
        );
        if (consumables.length === 0) return;

        const gapSeconds = tracker.lastObservedAt != null ? (now - tracker.lastObservedAt) / 1000 : null;
        const result = reconcileSnapshot({
            items: consumables.map((consumable) => ({
                itemHrid: consumable.itemHrid,
                lastKnown: snapshots?.[consumable.itemHrid],
                snapshot: consumable.count,
                maxRatePerSecond: this.getMaxRatePerDay(consumable.itemHrid) / 86400,
            })),
            gapSeconds,
            fightingSeconds,
        });
        this.applyReconciliation(tracker, result, now);
        this.logReconciliation(player.character?.name || 'party', result, gapSeconds, fightingSeconds);
    }

    /**
     * Temporary console diagnostics (#803): only outcomes worth looking at.
     */
    logReconciliation(who, result, gapSeconds, fightingSeconds) {
        const notable = result.items.filter((entry) => entry.action !== 'none' && entry.action !== 'baseline');
        if (notable.length === 0) return;
        diagLog('reconcile', {
            who,
            gapSeconds: gapSeconds === null ? null : Math.round(gapSeconds),
            fightingSeconds: fightingSeconds === null ? null : Math.round(fightingSeconds),
            unobserved: result.unobserved,
            excludeSeconds: Math.round(result.excludeSeconds),
            items: notable.map((entry) => `${entry.itemHrid}:${entry.action}:${entry.missed}`),
        });
    }

    /**
     * @param {string} itemHrid - Item HRID
     * @returns {number} Default consumed count (2 for drinks, 10 for food)
     */
    getDefaultConsumed(itemHrid) {
        const name = itemHrid.toLowerCase();
        if (name.includes('coffee') || name.includes('drink')) return 2;
        if (
            name.includes('donut') ||
            name.includes('cupcake') ||
            name.includes('cake') ||
            name.includes('gummy') ||
            name.includes('yogurt')
        )
            return 10;
        return 0;
    }

    /**
     * Calculate elapsed seconds since tracking started (MCS-style)
     * @param {Object} tracker - Tracker object (current player or party member)
     * @returns {number} Elapsed seconds
     */
    calcElapsedSeconds(tracker = null) {
        const targetTracker = tracker || this.consumableTracker;
        if (!targetTracker.startTime) {
            return 0;
        }
        return Math.max(0, (Date.now() - targetTracker.startTime - (targetTracker.excludedMs || 0)) / 1000);
    }

    /**
     * Create a new party member tracker (MCS-style)
     * @returns {Object} New tracker object
     */
    createPartyTracker() {
        return {
            actualConsumed: {},
            defaultConsumed: {},
            inventoryAmount: {},
            startTime: Date.now(),
            lastUpdate: null,
            excludedMs: 0,
            lastObservedAt: null,
        };
    }

    /**
     * Load consumable tracking state from storage
     */
    async loadConsumableTracking(characterId = this.characterId) {
        try {
            this._resetTrackingState();

            // Load current player tracker
            const saved = await this._loadCharacterScopedValue(
                LEGACY_STORAGE_KEYS.consumableTracker,
                null,
                characterId
            );
            if (saved) {
                // Restore tracking state
                this.consumableTracker.actualConsumed = saved.actualConsumed || {};
                this.consumableTracker.defaultConsumed = saved.defaultConsumed || {};
                this.consumableTracker.inventoryAmount = saved.inventoryAmount || {};
                this.consumableTracker.lastUpdate = saved.lastUpdate || null;

                if (saved.trackerVersion === 2 && saved.startTime) {
                    // Wall-clock start plus the explicit time left out of the rate, so time the page
                    // spent closed is reconciled against the next snapshot instead of silently dropped
                    this.consumableTracker.startTime = saved.startTime;
                    this.consumableTracker.excludedMs = saved.excludedMs || 0;
                    this.consumableTracker.lastObservedAt = saved.lastObservedAt || null;
                    this.consumableTracker.runKey = saved.runKey || null;
                    this.consumableTracker.lastBattleId = saved.lastBattleId ?? null;
                    this.consumableTracker.lastWave = saved.lastWave ?? null;
                    this.consumableTracker.lastBattleAt = saved.lastBattleAt || null;
                    this.consumableTracker.waveIntervalSum = saved.waveIntervalSum || 0;
                    this.consumableTracker.waveIntervalCount = saved.waveIntervalCount || 0;
                } else if (saved.elapsedMs !== undefined && saved.saveTimestamp) {
                    // Legacy format: restore elapsed time by adjusting startTime (no baseline to reconcile)
                    this.consumableTracker.startTime = Date.now() - saved.elapsedMs;
                } else if (saved.startTime) {
                    // Legacy: direct startTime (will include offline time)
                    this.consumableTracker.startTime = saved.startTime;
                }
            }

            // Load party member trackers (MCS-style)
            const savedPartyTrackers = await this._loadCharacterScopedValue(
                LEGACY_STORAGE_KEYS.partyConsumableTrackers,
                null,
                characterId
            );
            if (savedPartyTrackers) {
                const now = Date.now();
                this.partyConsumableTrackers = {};
                Object.keys(savedPartyTrackers).forEach((playerName) => {
                    const playerTracker = savedPartyTrackers[playerName];
                    if (
                        playerTracker.actualConsumed &&
                        playerTracker.defaultConsumed &&
                        playerTracker.inventoryAmount
                    ) {
                        const elapsedMs = playerTracker.elapsedMs || 0;
                        const isCurrentFormat = playerTracker.trackerVersion === 2 && playerTracker.startTime;
                        this.partyConsumableTrackers[playerName] = {
                            actualConsumed: playerTracker.actualConsumed || {},
                            defaultConsumed: playerTracker.defaultConsumed || {},
                            inventoryAmount: playerTracker.inventoryAmount || {},
                            startTime: isCurrentFormat ? playerTracker.startTime : now - elapsedMs,
                            lastUpdate: playerTracker.lastUpdate || null,
                            excludedMs: isCurrentFormat ? playerTracker.excludedMs || 0 : 0,
                            lastObservedAt: isCurrentFormat ? playerTracker.lastObservedAt || null : null,
                        };
                    }
                });
            }

            // Load party snapshots
            const savedSnapshots = await this._loadCharacterScopedValue(
                LEGACY_STORAGE_KEYS.partyConsumableSnapshots,
                null,
                characterId
            );
            if (savedSnapshots) {
                this.partyConsumableSnapshots = savedSnapshots;
            }
        } catch (error) {
            console.error('[Combat Stats] Error loading consumable tracking:', error);
        }
    }

    /**
     * Cap elapsed time and counts to a maximum window, preserving the rate ratio.
     * Prevents long-running sessions from dominating the rate after a reload.
     * @param {Object} counts - actualConsumed or defaultConsumed map (not mutated)
     * @param {number} elapsedMs - Raw elapsed time in ms
     * @param {number} maxMs - Maximum window in ms
     * @returns {{counts: Object, elapsedMs: number}}
     */
    capToWindow(counts, elapsedMs, maxMs) {
        if (elapsedMs <= maxMs) {
            return { counts, elapsedMs };
        }
        const ratio = maxMs / elapsedMs;
        const capped = {};
        Object.keys(counts).forEach((k) => {
            capped[k] = Math.round(counts[k] * ratio);
        });
        return { counts: capped, elapsedMs: maxMs };
    }

    /**
     * Save consumable tracking state to storage
     */
    async saveConsumableTracking(characterId = this.characterId, generation = this.lifecycleGeneration) {
        try {
            if (generation !== this.lifecycleGeneration) return;
            const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
            const consumableTrackerKey = this._getStorageKey(LEGACY_STORAGE_KEYS.consumableTracker, characterId);
            const partyTrackersKey = this._getStorageKey(LEGACY_STORAGE_KEYS.partyConsumableTrackers, characterId);
            const partySnapshotsKey = this._getStorageKey(LEGACY_STORAGE_KEYS.partyConsumableSnapshots, characterId);

            const selfExcludedMs = this.consumableTracker.excludedMs || 0;
            const rawElapsedMs = this.consumableTracker.startTime
                ? Date.now() - this.consumableTracker.startTime - selfExcludedMs
                : 0;
            const { counts: cappedActual, elapsedMs: cappedElapsed } = this.capToWindow(
                this.consumableTracker.actualConsumed,
                rawElapsedMs,
                MAX_WINDOW_MS
            );
            const { counts: cappedDefault } = this.capToWindow(
                this.consumableTracker.defaultConsumed,
                rawElapsedMs,
                MAX_WINDOW_MS
            );
            const trackerToSave = {
                actualConsumed: cappedActual,
                defaultConsumed: cappedDefault,
                inventoryAmount: { ...this.consumableTracker.inventoryAmount },
                lastUpdate: this.consumableTracker.lastUpdate,
                elapsedMs: cappedElapsed,
                saveTimestamp: Date.now(),
                trackerVersion: 2,
                startTime: this.consumableTracker.startTime ? Date.now() - cappedElapsed - selfExcludedMs : null,
                excludedMs: selfExcludedMs,
                lastObservedAt: this.consumableTracker.lastObservedAt,
                runKey: this.consumableTracker.runKey,
                lastBattleId: this.consumableTracker.lastBattleId,
                lastWave: this.consumableTracker.lastWave,
                lastBattleAt: this.consumableTracker.lastBattleAt,
                waveIntervalSum: this.consumableTracker.waveIntervalSum,
                waveIntervalCount: this.consumableTracker.waveIntervalCount,
            };

            const partyTrackersToSave = {};
            Object.keys(this.partyConsumableTrackers).forEach((playerName) => {
                const tracker = this.partyConsumableTrackers[playerName];
                if (!tracker?.actualConsumed || !tracker.defaultConsumed || !tracker.inventoryAmount) return;

                const partyExcludedMs = tracker.excludedMs || 0;
                const rawPartyElapsedMs = tracker.startTime ? Date.now() - tracker.startTime - partyExcludedMs : 0;
                const { counts: pCappedActual, elapsedMs: pCappedElapsed } = this.capToWindow(
                    tracker.actualConsumed,
                    rawPartyElapsedMs,
                    MAX_WINDOW_MS
                );
                const { counts: pCappedDefault } = this.capToWindow(
                    tracker.defaultConsumed,
                    rawPartyElapsedMs,
                    MAX_WINDOW_MS
                );
                partyTrackersToSave[playerName] = {
                    actualConsumed: pCappedActual,
                    defaultConsumed: pCappedDefault,
                    inventoryAmount: { ...tracker.inventoryAmount },
                    elapsedMs: pCappedElapsed,
                    lastUpdate: tracker.lastUpdate || null,
                    saveTimestamp: Date.now(),
                    trackerVersion: 2,
                    startTime: tracker.startTime ? Date.now() - pCappedElapsed - partyExcludedMs : null,
                    excludedMs: partyExcludedMs,
                    lastObservedAt: tracker.lastObservedAt || null,
                };
            });
            const partySnapshotsToSave = structuredClone(this.partyConsumableSnapshots);

            if (generation !== this.lifecycleGeneration) return;
            await storage.setJSON(consumableTrackerKey, trackerToSave, COMBAT_STATS_STORE);
            if (generation !== this.lifecycleGeneration) return;
            await storage.setJSON(partyTrackersKey, partyTrackersToSave, COMBAT_STATS_STORE);
            if (generation !== this.lifecycleGeneration) return;
            await storage.setJSON(partySnapshotsKey, partySnapshotsToSave, COMBAT_STATS_STORE);
        } catch (error) {
            console.error('[Combat Stats] Error saving consumable tracking:', error);
        }
    }

    /**
     * Reset consumable tracking (for new combat session)
     */
    async resetConsumableTracking(characterId = this.characterId) {
        this._resetTrackingState(Date.now());
        void Promise.all([
            storage.setJSON(
                this._getStorageKey(LEGACY_STORAGE_KEYS.consumableTracker, characterId),
                null,
                COMBAT_STATS_STORE
            ),
            storage.setJSON(
                this._getStorageKey(LEGACY_STORAGE_KEYS.partyConsumableTrackers, characterId),
                null,
                COMBAT_STATS_STORE
            ),
            storage.setJSON(
                this._getStorageKey(LEGACY_STORAGE_KEYS.partyConsumableSnapshots, characterId),
                null,
                COMBAT_STATS_STORE
            ),
        ]).catch((error) => {
            console.error('[Combat Stats] Error clearing consumable tracking:', error);
        });
    }

    /**
     * Handle battle_consumable_ability_updated event (fires on each consumption)
     * NOTE: This event only fires for the CURRENT PLAYER (solo tracking)
     * @param {Object} data - Consumable update data
     */
    async onConsumableUsed(data, generation = this.lifecycleGeneration) {
        try {
            if (generation !== this.lifecycleGeneration || !this.isInitialized) return;
            // Skip ability consumptions
            const itemHrid = data.consumable?.itemHrid;
            if (!itemHrid || itemHrid.includes('/ability/')) {
                return;
            }

            if (!data || !data.consumable) {
                return;
            }

            const now = Date.now();

            // Deduplicate: skip if we already processed this item within 100ms
            // (game sometimes sends duplicate events)
            const lastEventTime = this.consumableTracker.lastEventByItem[itemHrid] || 0;
            if (now - lastEventTime < 100) {
                consumableDebugRecorder.recordEvent(itemHrid, false);
                return; // Skip duplicate event
            }
            this.consumableTracker.lastEventByItem[itemHrid] = now;
            this.consumableTracker.lastObservedAt = now;
            consumableDebugRecorder.recordEvent(itemHrid, true, data.consumable.count);

            // Initialize tracking if first event
            if (!this.consumableTracker.startTime) {
                this.consumableTracker.startTime = now;
            }

            // Initialize item if first time seen (MCS-style)
            if (this.consumableTracker.actualConsumed[itemHrid] === undefined) {
                this.consumableTracker.actualConsumed[itemHrid] = 0;
                this.consumableTracker.defaultConsumed[itemHrid] = this.getDefaultConsumed(itemHrid);
            }

            // Increment consumption count
            this.consumableTracker.actualConsumed[itemHrid]++;
            this.consumableTracker.lastUpdate = now;

            // Update inventory amount from event data
            if (data.consumable.count !== undefined) {
                this.consumableTracker.inventoryAmount[itemHrid] = data.consumable.count;
            }

            // Persist after each consumption (MCS-style)
            await this.saveConsumableTracking(this.characterId, generation);
        } catch (error) {
            console.error('[Combat Stats] Error processing consumable event:', error);
        }
    }

    /**
     * Resolve the currently active combat zone/action, if any.
     * @returns {{zoneHrid: string, isDungeon: boolean, difficultyTier: number}|null} Zone info or null
     */
    getCurrentZoneInfo() {
        const actions = dataManager.getCurrentActions();
        const combatAction = actions.find(
            (action) => action.actionHrid?.startsWith('/actions/combat/') && !action.isDone
        );
        if (!combatAction) {
            return null;
        }

        const actionDetails = dataManager.getActionDetails(combatAction.actionHrid);
        return {
            zoneHrid: combatAction.actionHrid,
            isDungeon: actionDetails?.combatZoneInfo?.isDungeon === true,
            difficultyTier: combatAction.difficultyTier || 0,
        };
    }

    /**
     * Treat the previously-snapshotted battle as one completed regular-zone encounter (never the
     * currently-active one), then snapshot this battle's monster composition and live multipliers
     * for the next call. Dungeons are handled separately via `dungeonTracker.onUpdate` - no
     * per-monster tracking happens while the current zone is a dungeon.
     *
     * Also snapshots the current player's total loot the moment tracking starts, so "Actual" for
     * the comparison can be measured over the exact same window as "Expected" - reusing the
     * session-wide `totalLootMap` directly would compare a short Expected sample against a much
     * longer Actual window (e.g. the script attaching mid-fight), silently mis-scaling the result.
     * @param {Object} data - new_battle message data
     * @param {string} currentCharacterId - The current player's character ID
     */
    processExpectedLoot(data, currentCharacterId) {
        const selfPlayer = data.players.find((player) => player?.character?.id === currentCharacterId);
        this.latestSelfCombatDropQuantity = selfPlayer?.combatDetails?.combatStats?.combatDropQuantity || 0;

        const zoneInfo = this.getCurrentZoneInfo();
        if (!zoneInfo || zoneInfo.isDungeon) {
            this.pendingEncounter = null;
            this.actualLootSnapshot = null;
            this.trackedZoneKey = null;
            this.runLuckSnapshot = null;
            return;
        }

        const zoneKey = `${zoneInfo.zoneHrid}:${zoneInfo.isDungeon}`;
        if (this.trackedZoneKey !== null && this.trackedZoneKey !== zoneKey) {
            // Zone changed - the expected-loot tracker resets internally for the same reason;
            // the actual-loot snapshot must reset in lockstep or it would diff against a stale
            // baseline from the previous zone.
            this.pendingEncounter = null;
            this.actualLootSnapshot = null;
        }
        this.trackedZoneKey = zoneKey;

        if (this.actualLootSnapshot === null) {
            this.actualLootSnapshot = sumLootByItemHrid(selfPlayer?.totalLootMap);
            this.expectedLootTracker.markSampleStart(zoneInfo.zoneHrid, false);
        }

        if (this.pendingEncounter) {
            this.expectedLootTracker.recordCompletedEncounter(this.pendingEncounter);
        }

        // Level Malus is SERVER-CONFIRMED to use the raw (unfloored) whole-skill Combat Level -
        // not the native floored combatDetails.combatLevel field - so it's derived from the same
        // seven whole skill-level fields and the same shared helper Combat Sim uses, rather than
        // read directly. See calculateLevelGapDebuff()'s doc comment in combat-sim-adapter.js.
        const levels = data.players.map((player) => getRawCombatLevel(player)).filter((level) => level !== null);
        const maxCombatLevel = levels.length > 0 ? Math.max(...levels) : 0;
        const selfCombatLevel = getRawCombatLevel(selfPlayer);
        const debuffOnLevelGap =
            typeof selfCombatLevel === 'number' && maxCombatLevel > 0
                ? calculateLevelGapDebuff(selfCombatLevel, maxCombatLevel)
                : 0;

        const monsterHrids = (data.monsters || []).map((monster) => monster?.hrid).filter(Boolean);
        const dropRateBonus = selfPlayer?.combatDetails?.combatStats?.combatDropRate || 0;
        const rareFindBonus = selfPlayer?.combatDetails?.combatStats?.combatRareFind || 0;

        this.pendingEncounter = {
            zoneHrid: zoneInfo.zoneHrid,
            monsterHrids,
            difficultyTier: zoneInfo.difficultyTier,
            numberOfPlayers: data.players.length,
            dropRateMultiplier: 1 + dropRateBonus,
            rareFindMultiplier: 1 + rareFindBonus,
            combatDropQuantity: this.latestSelfCombatDropQuantity,
            debuffOnLevelGap,
        };

        this.updateRunLuckSnapshot(data, selfPlayer, zoneInfo, this.pendingEncounter);
    }

    /**
     * Snapshot what the run-wide loot luck needs from this message: the run's wave count, age and
     * cumulative loot, plus the player's current modifiers. Stateless by design - each message
     * replaces the last, and `battleId` already includes waves fought while the page was closed.
     * @param {Object} data - new_battle message data
     * @param {Object|undefined} selfPlayer - The current player's entry in `data.players`
     * @param {{zoneHrid: string, difficultyTier: number}} zoneInfo - The active regular zone
     * @param {Object} modifiers - Current drop modifiers (see `buildRunLootData`)
     */
    updateRunLuckSnapshot(data, selfPlayer, zoneInfo, modifiers) {
        const capturedAt = Date.now();
        const startedAt = data.combatStartTime ? new Date(data.combatStartTime).getTime() : NaN;
        const battleId = Number(data.battleId);

        if (!selfPlayer || !Number.isFinite(startedAt) || !Number.isFinite(battleId) || battleId < 2) {
            this.runLuckSnapshot = null;
            return;
        }

        this.runLuckSnapshot = {
            zoneHrid: zoneInfo.zoneHrid,
            completedWaves: battleId - 1,
            elapsedSeconds: (capturedAt - startedAt) / 1000,
            actualLoot: Object.entries(sumLootByItemHrid(selfPlayer.totalLootMap)).map(([itemHrid, count]) => ({
                itemHrid,
                count,
            })),
            modifiers: {
                difficultyTier: modifiers.difficultyTier,
                numberOfPlayers: modifiers.numberOfPlayers,
                dropRateMultiplier: modifiers.dropRateMultiplier,
                rareFindMultiplier: modifiers.rareFindMultiplier,
                combatDropQuantity: modifiers.combatDropQuantity,
                debuffOnLevelGap: modifiers.debuffOnLevelGap,
            },
        };
    }

    /**
     * @returns {Object|null} The latest run luck snapshot, null outside a regular-zone run
     */
    getRunLuckSnapshot() {
        return this.runLuckSnapshot;
    }

    /**
     * Actual loot the current player has gained since the expected-loot tracking window started
     * (never the whole combat session), so Actual and Expected in the RNG Delta comparison always
     * cover the exact same sample.
     * @returns {Array<{itemHrid: string, count: number}>} Items gained since tracking started
     */
    getActualLootSinceTrackingStarted() {
        if (!this.actualLootSnapshot || !this.latestCombatData) {
            return [];
        }

        const selfPlayer = this.latestCombatData.players.find((player) => player.isCurrentPlayer);
        if (!selfPlayer) {
            return [];
        }

        const currentTotals = sumLootByItemHrid(selfPlayer.loot);
        const items = [];
        for (const [itemHrid, currentCount] of Object.entries(currentTotals)) {
            const startCount = this.actualLootSnapshot[itemHrid] || 0;
            const gained = currentCount - startCount;
            if (gained > 0) {
                items.push({ itemHrid, count: gained });
            }
        }
        return items;
    }

    /**
     * Handle new_battle message (fires during combat)
     * @param {Object} data - new_battle message data
     */
    async onNewBattle(data, generation = this.lifecycleGeneration) {
        try {
            if (generation !== this.lifecycleGeneration || !this.isInitialized) return;
            const characterId = this.characterId;
            // Only process if we have players data
            if (!data.players || data.players.length === 0) {
                return;
            }

            const battleId = data.battleId || 0;

            // Calculate duration from combat start time
            const combatStartTime = new Date(data.combatStartTime).getTime() / 1000;
            const currentTime = Date.now() / 1000;
            const durationSeconds = currentTime - combatStartTime;

            // Calculate elapsed tracking time (MCS-style)
            const elapsedSeconds = this.calcElapsedSeconds();

            // Detect new combat session and reset consumable tracking
            // Primary: battleId decreased (went back to 1 or lower)
            // Fallback: combat duration is shorter than tracking duration (missed a reset while offline)
            // A different combatStartTime is a different run, even if the page was closed in between
            const runChanged =
                Boolean(this.consumableTracker.runKey) &&
                Boolean(data.combatStartTime) &&
                this.consumableTracker.runKey !== data.combatStartTime;
            const battleIdDecreased = this.currentBattleId !== null && battleId < this.currentBattleId;
            const shouldResetTracking =
                runChanged || battleIdDecreased || (elapsedSeconds > 0 && durationSeconds < elapsedSeconds);

            if (shouldResetTracking) {
                let resetReason = 'combat duration shorter than tracking duration';
                if (runChanged) resetReason = 'combatStartTime changed';
                else if (battleIdDecreased) resetReason = 'battleId decreased';
                consumableDebugRecorder.recordTrackingReset(resetReason);
                await this.resetConsumableTracking(characterId);
                if (generation !== this.lifecycleGeneration) return;
                this.pendingEncounter = null;
                this.actualLootSnapshot = null;
                this.trackedZoneKey = null;
                this.runLuckSnapshot = null;
                this.expectedLootTracker.reset();
            }

            // Update current battle ID
            this.currentBattleId = battleId;

            // Get current character ID to identify which player is the current user
            const currentCharacterId = dataManager.getCurrentCharacterId();

            this.processExpectedLoot(data, currentCharacterId);

            const selfPlayer = data.players.find((p) => p?.character?.id === currentCharacterId);
            consumableDebugRecorder.recordNewBattle(selfPlayer?.combatConsumables);

            // Recover consumption the event stream missed while the page was closed or suspended
            const now = Date.now();
            const fightingSeconds = this.estimateGapFightingSeconds(data);
            this.reconcileSelfConsumables(selfPlayer, fightingSeconds, now);
            this.updateRunPosition(data, now);

            // Track party member consumables via inventory snapshots (MCS-style)
            const currentPartyMembers = new Set();
            data.players.forEach((player) => {
                if (!player || !player.character) return;
                const playerName = player.character.name;
                currentPartyMembers.add(playerName);

                // Skip current player (tracked via consumable events)
                if (player.character.id === currentCharacterId) {
                    return;
                }

                // Initialize snapshot storage if needed
                if (!this.partyConsumableSnapshots[playerName]) {
                    this.partyConsumableSnapshots[playerName] = {};
                }

                if (!this.partyLastKnownConsumables) {
                    this.partyLastKnownConsumables = {};
                }
                if (!this.partyLastKnownConsumables[playerName]) {
                    this.partyLastKnownConsumables[playerName] = {};
                }

                // Initialize tracker if needed
                if (!this.partyConsumableTrackers[playerName]) {
                    this.partyConsumableTrackers[playerName] = this.createPartyTracker();
                    // Initialize all consumables
                    if (player.combatConsumables) {
                        player.combatConsumables.forEach((consumable) => {
                            if (consumable && consumable.itemHrid) {
                                this.partyConsumableTrackers[playerName].actualConsumed[consumable.itemHrid] = 0;
                                this.partyConsumableTrackers[playerName].defaultConsumed[consumable.itemHrid] =
                                    this.getDefaultConsumed(consumable.itemHrid);
                            }
                        });
                    }
                }

                const tracker = this.partyConsumableTrackers[playerName];

                // Remove items no longer in consumables
                if (player.combatConsumables && player.combatConsumables.length > 0 && tracker) {
                    const currentConsumableHrids = new Set(
                        player.combatConsumables.filter((c) => c && c.itemHrid).map((c) => c.itemHrid)
                    );

                    Object.keys(tracker.actualConsumed).forEach((itemHrid) => {
                        if (!currentConsumableHrids.has(itemHrid)) {
                            delete tracker.actualConsumed[itemHrid];
                            delete tracker.defaultConsumed[itemHrid];
                            delete tracker.inventoryAmount[itemHrid];
                        }
                    });
                }

                // Credit consumption missed since this member's last snapshot, then take a new baseline
                this.reconcilePartyConsumables(
                    tracker,
                    this.partyConsumableSnapshots[playerName],
                    player,
                    fightingSeconds,
                    now
                );

                // Track current consumables
                const currentlySeenHrids = new Set();
                if (player.combatConsumables && player.combatConsumables.length > 0) {
                    player.combatConsumables.forEach((consumable) => {
                        if (!consumable || !consumable.itemHrid) return;

                        const itemHrid = consumable.itemHrid;
                        const currentCount = consumable.count;

                        currentlySeenHrids.add(itemHrid);

                        this.partyLastKnownConsumables[playerName][itemHrid] = {
                            itemHrid: itemHrid,
                            lastSeenCount: currentCount,
                        };

                        // Update snapshot
                        this.partyConsumableSnapshots[playerName][itemHrid] = currentCount;
                        tracker.inventoryAmount[itemHrid] = currentCount;
                    });
                }

                // Handle items that disappeared (ran out or removed)
                Object.keys(this.partyLastKnownConsumables[playerName] || {}).forEach((itemHrid) => {
                    if (!currentlySeenHrids.has(itemHrid)) {
                        const previousCount = this.partyConsumableSnapshots[playerName][itemHrid];
                        if (previousCount !== undefined && previousCount > 0) {
                            tracker.inventoryAmount[itemHrid] = 0;
                            this.partyConsumableSnapshots[playerName][itemHrid] = 0;
                        }
                    }
                });
            });

            // Clean up trackers for players who left the party
            Object.keys(this.partyConsumableTrackers).forEach((playerName) => {
                if (!currentPartyMembers.has(playerName)) {
                    delete this.partyConsumableTrackers[playerName];
                }
            });
            Object.keys(this.partyConsumableSnapshots).forEach((playerName) => {
                if (!currentPartyMembers.has(playerName)) {
                    delete this.partyConsumableSnapshots[playerName];
                }
            });
            Object.keys(this.partyLastKnownConsumables).forEach((playerName) => {
                if (!currentPartyMembers.has(playerName)) {
                    delete this.partyLastKnownConsumables[playerName];
                }
            });

            // Extract combat data. Tracking state is persisted once at the end of this update.
            const combatData = {
                timestamp: Date.now(),
                battleId: battleId,
                combatStartTime: data.combatStartTime,
                durationSeconds: durationSeconds,
                players: data.players.map((player) => {
                    // Check if this player is the current user by matching character ID
                    const isCurrentPlayer = player.character.id === currentCharacterId;

                    // Process consumables
                    const consumablesWithConsumed = [];
                    const seenItems = new Set();

                    if (player.combatConsumables) {
                        for (const consumable of player.combatConsumables) {
                            if (seenItems.has(consumable.itemHrid)) {
                                continue;
                            }
                            seenItems.add(consumable.itemHrid);

                            // Get tracking data
                            let actualConsumed;
                            let defaultConsumed;
                            let trackingElapsed;
                            let inventoryAmount;

                            if (isCurrentPlayer) {
                                // Current player: use event-based tracking
                                this.consumableTracker.inventoryAmount[consumable.itemHrid] = consumable.count;
                                actualConsumed = this.consumableTracker.actualConsumed[consumable.itemHrid] || 0;
                                defaultConsumed =
                                    this.consumableTracker.defaultConsumed[consumable.itemHrid] ||
                                    this.getDefaultConsumed(consumable.itemHrid);
                                trackingElapsed = elapsedSeconds;
                                inventoryAmount =
                                    this.consumableTracker.inventoryAmount[consumable.itemHrid] !== undefined
                                        ? this.consumableTracker.inventoryAmount[consumable.itemHrid]
                                        : consumable.count;
                            } else {
                                // Party member: use snapshot-based tracking (MCS-style)
                                const playerName = player.character.name;
                                const partyTracker = this.partyConsumableTrackers[playerName];

                                if (partyTracker) {
                                    actualConsumed = partyTracker.actualConsumed[consumable.itemHrid] || 0;
                                    defaultConsumed =
                                        partyTracker.defaultConsumed[consumable.itemHrid] ||
                                        this.getDefaultConsumed(consumable.itemHrid);
                                    trackingElapsed = this.calcElapsedSeconds(partyTracker);
                                    inventoryAmount =
                                        partyTracker.inventoryAmount[consumable.itemHrid] !== undefined
                                            ? partyTracker.inventoryAmount[consumable.itemHrid]
                                            : consumable.count;
                                } else {
                                    // Fallback if tracker not initialized yet
                                    actualConsumed = 0;
                                    defaultConsumed = this.getDefaultConsumed(consumable.itemHrid);
                                    trackingElapsed = 0;
                                    inventoryAmount = consumable.count;
                                }
                            }

                            // MCS formula (exact match to MCS code lines 26027-26030)
                            const DEFAULT_TIME = 10 * 60; // 600 seconds
                            const actualRate = trackingElapsed > 0 ? actualConsumed / trackingElapsed : 0;
                            const combinedRate = (defaultConsumed + actualConsumed) / (DEFAULT_TIME + trackingElapsed);
                            const rawRate = actualRate * 0.9 + combinedRate * 0.1;

                            // Cap at game-theoretical maximum (cooldown-based):
                            // Drinks: 300s base / 1.2 max concentration (+20 guzzling pouch) = 345.6/day
                            // Food: 60s base cooldown = 1440/day (drink concentration doesn't affect food)
                            const maxRatePerDay = this.getMaxRatePerDay(consumable.itemHrid);
                            const consumptionRate = Math.min(rawRate, maxRatePerDay / 86400);

                            // Per-day rate (MCS uses Math.ceil)
                            const consumedPerDay = Math.ceil(consumptionRate * 86400);

                            // Estimate for this combat session
                            const estimatedConsumed = consumptionRate * durationSeconds;

                            // Time until inventory runs out (MCS-style)
                            const timeToZeroSeconds =
                                consumptionRate > 0 ? inventoryAmount / consumptionRate : Infinity;

                            const consumableData = {
                                itemHrid: consumable.itemHrid,
                                currentCount: consumable.count,
                                actualConsumed: actualConsumed,
                                defaultConsumed: defaultConsumed,
                                consumed: estimatedConsumed,
                                consumedPerDay: consumedPerDay,
                                consumptionRate: consumptionRate,
                                elapsedSeconds: trackingElapsed,
                                inventoryAmount: inventoryAmount,
                                timeToZeroSeconds: timeToZeroSeconds,
                            };
                            consumablesWithConsumed.push(consumableData);
                        }
                    }

                    return {
                        name: player.character.name,
                        characterId: player.character.id,
                        isCurrentPlayer: isCurrentPlayer,
                        loot: player.totalLootMap || {},
                        experience: player.totalSkillExperienceMap || {},
                        deathCount: player.deathCount || 0,
                        consumables: consumablesWithConsumed,
                        combatLevel: player.combatDetails?.combatLevel || null,
                        combatStats: {
                            combatDropQuantity: player.combatDetails?.combatStats?.combatDropQuantity || 0,
                            combatDropRate: player.combatDetails?.combatStats?.combatDropRate || 0,
                            combatRareFind: player.combatDetails?.combatStats?.combatRareFind || 0,
                            drinkConcentration: player.combatDetails?.combatStats?.drinkConcentration || 0,
                        },
                    };
                }),
            };

            // Store in memory
            this.latestCombatData = combatData;

            // Store in IndexedDB
            if (generation !== this.lifecycleGeneration) return;
            await storage.setJSON(
                this._getStorageKey(LEGACY_STORAGE_KEYS.latestCombatRun, characterId),
                combatData,
                COMBAT_STATS_STORE
            );

            // Also save tracking state periodically
            await this.saveConsumableTracking(characterId, generation);
        } catch (error) {
            console.error('[Combat Stats] Error collecting combat data:', error);
        }
    }

    /**
     * Get the latest combat data
     * @returns {Object|null} Latest combat data
     */
    getLatestData() {
        return this.latestCombatData;
    }

    /**
     * Diagnostics for the current player's consumable counts (issue #803), read from the console
     * via `toolashaConsumableDebug()`.
     * @returns {Object}
     */
    getConsumableDebugReport() {
        const elapsedSeconds = this.calcElapsedSeconds();
        const trackedItems = {};
        for (const [itemHrid, eventCount] of Object.entries(this.consumableTracker.actualConsumed)) {
            trackedItems[itemHrid] = {
                trackedActualConsumed: eventCount,
                trackedRatePerHour: elapsedSeconds > 0 ? Number(((eventCount / elapsedSeconds) * 3600).toFixed(2)) : 0,
            };
        }
        return consumableDebugRecorder.getReport({
            trackerStartedAt: this.consumableTracker.startTime
                ? new Date(this.consumableTracker.startTime).toISOString()
                : null,
            trackedHours: Number((elapsedSeconds / 3600).toFixed(2)),
            excludedHours: Number(((this.consumableTracker.excludedMs || 0) / 3600000).toFixed(2)),
            connectionInterrupted: this.connectionInterrupted,
            trackedItems,
        });
    }

    /**
     * Whether a WS disconnect/reconnect happened during the current tracking session, meaning
     * some events may have been missed and the session's numbers may be incomplete.
     * @returns {boolean}
     */
    isConnectionInterrupted() {
        return this.connectionInterrupted;
    }

    /**
     * Load latest combat data from storage
     * @returns {Promise<Object|null>} Latest combat data
     */
    async loadLatestData(characterId = this.characterId) {
        const data = await this._loadCharacterScopedValue(LEGACY_STORAGE_KEYS.latestCombatRun, null, characterId);
        this.latestCombatData = data || null;
        return data;
    }

    /**
     * Cleanup
     */
    cleanup() {
        this.lifecycleGeneration += 1;
        const pageWindow = getPageWindow();
        if (pageWindow) delete pageWindow[CONSUMABLE_DEBUG_GLOBAL];

        if (this.newBattleHandler) {
            webSocketHook.off('new_battle', this.newBattleHandler);
            this.newBattleHandler = null;
        }

        if (this.consumableEventHandler) {
            webSocketHook.off('battle_consumable_ability_updated', this.consumableEventHandler);
            this.consumableEventHandler = null;
        }

        if (this.socketCloseHandler) {
            webSocketHook.offSocketEvent('close', this.socketCloseHandler);
            this.socketCloseHandler = null;
        }

        if (this.dungeonCompletionHandler) {
            dungeonTracker.offUpdate(this.dungeonCompletionHandler);
            this.dungeonCompletionHandler = null;
        }

        this.isInitialized = false;
        this.latestCombatData = null;
        this.currentBattleId = null;
        this.pendingEncounter = null;
        this.latestSelfCombatDropQuantity = 0;
        this.actualLootSnapshot = null;
        this.trackedZoneKey = null;
        this.runLuckSnapshot = null;
        this.expectedLootTracker.reset();
        // Note: Don't reset consumableTracker here - it's persisted
    }
}

const combatStatsDataCollector = new CombatStatsDataCollector();

export { CombatStatsDataCollector };
export default combatStatsDataCollector;
