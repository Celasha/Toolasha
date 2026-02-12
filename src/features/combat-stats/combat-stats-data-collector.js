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

        // Consumable tracking state for current player (persisted to storage like MCS)
        this.consumableTracker = {
            actualConsumed: {}, // { itemHrid: count }
            defaultConsumed: {}, // { itemHrid: baselineCount }
            inventoryAmount: {}, // { itemHrid: currentCount }
            startTime: null, // When tracking started
            lastUpdate: null, // Last consumption event timestamp
            lastEventByItem: {}, // { itemHrid: timestamp } - for deduplication
        };

        // Party member consumable tracking (MCS-style)
        this.partyConsumableTrackers = {}; // { playerName: tracker }
        this.partyConsumableSnapshots = {}; // { playerName: { itemHrid: previousCount } }
        this.partyLastKnownConsumables = {}; // { playerName: { itemHrid: { itemHrid, lastSeenCount } } }
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
     * @param {Object} tracker - Tracker object (current player or party member)
     * @returns {number} Elapsed seconds
     */
    calcElapsedSeconds(tracker = null) {
        const targetTracker = tracker || this.consumableTracker;
        if (!targetTracker.startTime) {
            return 0;
        }
        return Math.max(0, (Date.now() - targetTracker.startTime) / 1000);
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
        };
    }

    /**
     * Load consumable tracking state from storage
     */
    async loadConsumableTracking() {
        try {
            // Load current player tracker
            const saved = await storage.getJSON('consumableTracker', 'combatStats', null);
            if (saved) {
                // Restore tracking state
                this.consumableTracker.actualConsumed = saved.actualConsumed || {};
                this.consumableTracker.defaultConsumed = saved.defaultConsumed || {};
                this.consumableTracker.inventoryAmount = saved.inventoryAmount || {};
                this.consumableTracker.lastUpdate = saved.lastUpdate || null;

                // Restore elapsed time by adjusting startTime
                if (saved.elapsedMs !== undefined && saved.saveTimestamp) {
                    this.consumableTracker.startTime = Date.now() - saved.elapsedMs;
                } else if (saved.startTime) {
                    // Legacy: direct startTime (will include offline time)
                    this.consumableTracker.startTime = saved.startTime;
                }
            }

            // Load party member trackers (MCS-style)
            const savedPartyTrackers = await storage.getJSON('partyConsumableTrackers', 'combatStats', null);
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
                        this.partyConsumableTrackers[playerName] = {
                            actualConsumed: playerTracker.actualConsumed || {},
                            defaultConsumed: playerTracker.defaultConsumed || {},
                            inventoryAmount: playerTracker.inventoryAmount || {},
                            startTime: now - elapsedMs,
                            lastUpdate: playerTracker.lastUpdate || null,
                        };
                    }
                });
            }

            // Load party snapshots
            const savedSnapshots = await storage.getJSON('partyConsumableSnapshots', 'combatStats', null);
            if (savedSnapshots) {
                this.partyConsumableSnapshots = savedSnapshots;
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
            // Save current player tracker
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

            // Save party member trackers (MCS-style)
            const partyTrackersToSave = {};
            Object.keys(this.partyConsumableTrackers).forEach((playerName) => {
                const tracker = this.partyConsumableTrackers[playerName];
                if (tracker && tracker.actualConsumed && tracker.defaultConsumed && tracker.inventoryAmount) {
                    partyTrackersToSave[playerName] = {
                        actualConsumed: tracker.actualConsumed || {},
                        defaultConsumed: tracker.defaultConsumed || {},
                        inventoryAmount: tracker.inventoryAmount || {},
                        elapsedMs: tracker.startTime ? Date.now() - tracker.startTime : 0,
                        lastUpdate: tracker.lastUpdate || null,
                        saveTimestamp: Date.now(),
                    };
                }
            });
            await storage.setJSON('partyConsumableTrackers', partyTrackersToSave, 'combatStats');

            // Save party snapshots
            await storage.setJSON('partyConsumableSnapshots', this.partyConsumableSnapshots, 'combatStats');
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

                // Track current consumables
                const currentlySeenHrids = new Set();
                if (player.combatConsumables && player.combatConsumables.length > 0) {
                    player.combatConsumables.forEach((consumable) => {
                        if (!consumable || !consumable.itemHrid) return;

                        const itemHrid = consumable.itemHrid;
                        const currentCount = consumable.count;
                        const previousCount = this.partyConsumableSnapshots[playerName][itemHrid];

                        currentlySeenHrids.add(itemHrid);

                        this.partyLastKnownConsumables[playerName][itemHrid] = {
                            itemHrid: itemHrid,
                            lastSeenCount: currentCount,
                        };

                        // Compare with previous snapshot to detect consumption (MCS-style)
                        if (previousCount !== undefined) {
                            const diff = previousCount - currentCount;

                            // Only count if exactly 1 consumed (conservative approach)
                            if (diff === 1) {
                                tracker.actualConsumed[itemHrid] = (tracker.actualConsumed[itemHrid] || 0) + 1;
                                tracker.lastUpdate = Date.now();
                            }
                        }

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

            // Persist party tracking data
            await this.saveConsumableTracking();

            // Extract combat data
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
                                    this.consumableTracker.inventoryAmount[consumable.itemHrid] || consumable.count;
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
                                        partyTracker.inventoryAmount[consumable.itemHrid] || consumable.count;
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
                            const consumptionRate = actualRate * 0.9 + combinedRate * 0.1;

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
