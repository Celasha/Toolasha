/**
 * Combat Statistics Data Collector
 * Listens for new_battle WebSocket messages and stores combat data
 */

import webSocketHook from '../../core/websocket.js';
import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';

class CombatStatsDataCollector {
    constructor() {
        this.isInitialized = false;
        this.newBattleHandler = null;
        this.consumableEventHandler = null;
        this.latestCombatData = null;
        this.currentBattleId = null;

        // Consumable tracking state (persisted to storage like MCS)
        this.consumableTracker = {
            actualConsumed: {}, // { itemHrid: count }
            defaultConsumed: {}, // { itemHrid: baselineCount }
            inventoryAmount: {}, // { itemHrid: currentCount }
            startTime: null, // When tracking started
            lastUpdate: null, // Last consumption event timestamp
            lastEventByItem: {}, // { itemHrid: timestamp } - for deduplication
        };
    }

    /**
     * Initialize the data collector
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Load persisted tracking state from storage (MCS-style)
        await this.loadConsumableTracking();

        // Store handler references for cleanup
        this.newBattleHandler = (data) => this.onNewBattle(data);
        this.consumableEventHandler = (data) => this.onConsumableUsed(data);

        // Listen for new_battle messages (fires during combat, continuously updated)
        webSocketHook.on('new_battle', this.newBattleHandler);

        // Listen for battle_consumable_ability_updated (fires on each consumable use)
        webSocketHook.on('battle_consumable_ability_updated', this.consumableEventHandler);
    }

    /**
     * Get default consumed count for an item (MCS-style baseline)
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
     * @returns {number} Elapsed seconds
     */
    calcElapsedSeconds() {
        if (!this.consumableTracker.startTime) {
            return 0;
        }
        return Math.max(0, (Date.now() - this.consumableTracker.startTime) / 1000);
    }

    /**
     * Load consumable tracking state from storage
     */
    async loadConsumableTracking() {
        try {
            const saved = await storage.getJSON('consumableTracker', 'combatStats', null);
            if (saved) {
                // Restore tracking state
                this.consumableTracker.actualConsumed = saved.actualConsumed || {};
                this.consumableTracker.defaultConsumed = saved.defaultConsumed || {};
                this.consumableTracker.inventoryAmount = saved.inventoryAmount || {};
                this.consumableTracker.lastUpdate = saved.lastUpdate || null;

                // Restore elapsed time by adjusting startTime
                // saved.elapsedMs = how much time had passed when we saved
                // saved.saveTimestamp = when we saved
                // Time since save = Date.now() - saved.saveTimestamp
                // New startTime = Date.now() - saved.elapsedMs (resume from where we left off)
                if (saved.elapsedMs !== undefined && saved.saveTimestamp) {
                    this.consumableTracker.startTime = Date.now() - saved.elapsedMs;
                } else if (saved.startTime) {
                    // Legacy: direct startTime (will include offline time)
                    this.consumableTracker.startTime = saved.startTime;
                }
            }
        } catch (error) {
            console.error('[Combat Stats] Error loading consumable tracking:', error);
        }
    }

    /**
     * Save consumable tracking state to storage
     */
    async saveConsumableTracking() {
        try {
            const toSave = {
                actualConsumed: this.consumableTracker.actualConsumed,
                defaultConsumed: this.consumableTracker.defaultConsumed,
                inventoryAmount: this.consumableTracker.inventoryAmount,
                lastUpdate: this.consumableTracker.lastUpdate,
                // Save elapsed time, not raw startTime (MCS-style)
                elapsedMs: this.consumableTracker.startTime ? Date.now() - this.consumableTracker.startTime : 0,
                saveTimestamp: Date.now(),
            };
            await storage.setJSON('consumableTracker', toSave, 'combatStats');
        } catch (error) {
            console.error('[Combat Stats] Error saving consumable tracking:', error);
        }
    }

    /**
     * Reset consumable tracking (for new combat session)
     */
    async resetConsumableTracking() {
        this.consumableTracker = {
            actualConsumed: {},
            defaultConsumed: {},
            inventoryAmount: {},
            startTime: Date.now(),
            lastUpdate: null,
            lastEventByItem: {},
        };
        await storage.setJSON('consumableTracker', null, 'combatStats');
    }

    /**
     * Handle battle_consumable_ability_updated event (fires on each consumption)
     * NOTE: This event only fires for the CURRENT PLAYER (solo tracking)
     * @param {Object} data - Consumable update data
     */
    async onConsumableUsed(data) {
        try {
            if (!data || !data.consumable || !data.consumable.itemHrid) {
                return;
            }

            const itemHrid = data.consumable.itemHrid;
            const now = Date.now();

            // Deduplicate: skip if we already processed this item within 100ms
            // (game sometimes sends duplicate events)
            const lastEventTime = this.consumableTracker.lastEventByItem[itemHrid] || 0;
            if (now - lastEventTime < 100) {
                return; // Skip duplicate event
            }
            this.consumableTracker.lastEventByItem[itemHrid] = now;

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
            await this.saveConsumableTracking();
        } catch (error) {
            console.error('[Combat Stats] Error processing consumable event:', error);
        }
    }

    /**
     * Handle new_battle message (fires during combat)
     * @param {Object} data - new_battle message data
     */
    async onNewBattle(data) {
        try {
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

            // Get current character ID to identify which player is the current user
            const currentCharacterId = dataManager.getCurrentCharacterId();

            // Extract combat data
            const combatData = {
                timestamp: Date.now(),
                battleId: battleId,
                combatStartTime: data.combatStartTime,
                durationSeconds: durationSeconds,
                players: data.players.map((player) => {
                    // Check if this player is the current user by matching character ID
                    const isCurrentPlayer = player.character.id === currentCharacterId;

                    // Process consumables - only track for current player
                    const consumablesWithConsumed = [];
                    const seenItems = new Set();

                    if (player.combatConsumables) {
                        for (const consumable of player.combatConsumables) {
                            if (seenItems.has(consumable.itemHrid)) {
                                continue;
                            }
                            seenItems.add(consumable.itemHrid);

                            // Update inventory amount from new_battle data (only for current player)
                            if (isCurrentPlayer) {
                                this.consumableTracker.inventoryAmount[consumable.itemHrid] = consumable.count;
                            }

                            // Get tracking data (only accurate for current player)
                            const actualConsumed = isCurrentPlayer
                                ? this.consumableTracker.actualConsumed[consumable.itemHrid] || 0
                                : 0;
                            const defaultConsumed = isCurrentPlayer
                                ? this.consumableTracker.defaultConsumed[consumable.itemHrid] ||
                                  this.getDefaultConsumed(consumable.itemHrid)
                                : this.getDefaultConsumed(consumable.itemHrid);

                            let consumptionRate;
                            let consumedPerDay;
                            let trackingElapsed;

                            if (isCurrentPlayer) {
                                // Current player: Use MCS formula with tracked consumption
                                const DEFAULT_TIME = 10 * 60; // 600 seconds
                                trackingElapsed = elapsedSeconds;

                                const actualRate = trackingElapsed > 0 ? actualConsumed / trackingElapsed : 0;
                                const combinedRate =
                                    (defaultConsumed + actualConsumed) / (DEFAULT_TIME + trackingElapsed);
                                consumptionRate = actualRate * 0.9 + combinedRate * 0.1;

                                // Per-day rate (MCS uses Math.ceil)
                                consumedPerDay = Math.ceil(consumptionRate * 86400);
                            } else {
                                // Party member: Use baseline only (we don't receive their consumable events)
                                // Baseline assumption: consume once per 10 minutes (600 seconds)
                                const BASELINE_INTERVAL = 10 * 60; // 600 seconds
                                consumptionRate = defaultConsumed / BASELINE_INTERVAL;
                                trackingElapsed = 0; // Party members don't have tracking

                                // Per-day rate based on baseline
                                consumedPerDay = Math.ceil(consumptionRate * 86400);
                            }

                            // Estimate for this combat session
                            const estimatedConsumed = consumptionRate * durationSeconds;

                            // Time until inventory runs out (MCS-style)
                            const inventoryAmount = isCurrentPlayer
                                ? this.consumableTracker.inventoryAmount[consumable.itemHrid] || consumable.count
                                : consumable.count;
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
            await storage.setJSON('latestCombatRun', combatData, 'combatStats');

            // Also save tracking state periodically
            await this.saveConsumableTracking();
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
     * Load latest combat data from storage
     * @returns {Promise<Object|null>} Latest combat data
     */
    async loadLatestData() {
        const data = await storage.getJSON('latestCombatRun', 'combatStats', null);
        if (data) {
            this.latestCombatData = data;
        }
        return data;
    }

    /**
     * Cleanup
     */
    cleanup() {
        if (this.newBattleHandler) {
            webSocketHook.off('new_battle', this.newBattleHandler);
            this.newBattleHandler = null;
        }

        if (this.consumableEventHandler) {
            webSocketHook.off('battle_consumable_ability_updated', this.consumableEventHandler);
            this.consumableEventHandler = null;
        }

        this.isInitialized = false;
        this.latestCombatData = null;
        this.currentBattleId = null;
        // Note: Don't reset consumableTracker here - it's persisted
    }
}

const combatStatsDataCollector = new CombatStatsDataCollector();

export default combatStatsDataCollector;
