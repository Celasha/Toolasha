/**
 * Combat Statistics Data Collector
 * Listens for new_battle WebSocket messages and stores combat data
 */

import webSocketHook from '../../core/websocket.js';
import storage from '../../core/storage.js';

class CombatStatsDataCollector {
    constructor() {
        this.isInitialized = false;
        this.newBattleHandler = null;
        this.consumableEventHandler = null; // NEW: for battle_consumable_ability_updated
        this.latestCombatData = null;
        this.currentBattleId = null;
        this.consumableActualConsumed = {}; // { characterId: { itemHrid: count } } - from consumption events
        this.trackingStartTime = {}; // { characterId: timestamp } - when we started tracking
    }

    /**
     * Initialize the data collector
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Store handler references for cleanup
        this.newBattleHandler = (data) => this.onNewBattle(data);
        this.consumableEventHandler = (data) => this.onConsumableUsed(data);

        // Listen for new_battle messages (fires during combat, continuously updated)
        webSocketHook.on('new_battle', this.newBattleHandler);

        // Listen for battle_consumable_ability_updated (fires on each consumable use)
        webSocketHook.on('battle_consumable_ability_updated', this.consumableEventHandler);
    }

    /**
     * Handle battle_consumable_ability_updated event (fires on each consumption)
     * NOTE: This event only fires for the CURRENT PLAYER (solo tracking)
     * @param {Object} data - Consumable update data
     */
    onConsumableUsed(data) {
        try {
            if (!data || !data.consumable || !data.consumable.itemHrid) {
                return;
            }

            // Use 'current' key for solo player tracking (event only fires for current player)
            const characterId = 'current';

            // Initialize tracking for current player if needed
            if (!this.consumableActualConsumed[characterId]) {
                this.consumableActualConsumed[characterId] = {};
                this.trackingStartTime[characterId] = Date.now();
            }

            const itemHrid = data.consumable.itemHrid;

            // Initialize count for this item if first time seen
            if (!this.consumableActualConsumed[characterId][itemHrid]) {
                this.consumableActualConsumed[characterId][itemHrid] = 0;
            }

            // Increment consumption count (this event fires once per use)
            this.consumableActualConsumed[characterId][itemHrid]++;
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

            // Detect new combat run (new battleId)
            const battleId = data.battleId || 0;

            // Only reset if we haven't initialized yet (first run after script load)
            // Don't reset on every battleId change since that happens every wave!

            // Calculate duration from combat start time
            const combatStartTime = new Date(data.combatStartTime).getTime() / 1000;
            const currentTime = Date.now() / 1000;
            const durationSeconds = currentTime - combatStartTime;

            // Extract combat data
            const combatData = {
                timestamp: Date.now(),
                battleId: battleId,
                combatStartTime: data.combatStartTime,
                durationSeconds: durationSeconds,
                players: data.players.map((player, index) => {
                    const characterId = player.character.id;

                    // For the first player (current player), use event-based consumption tracking
                    // For other players (party members), we'd need snapshot-based tracking (TODO)
                    const trackingKey = index === 0 ? 'current' : characterId;

                    // Initialize tracking for this character if needed
                    if (!this.consumableActualConsumed[trackingKey]) {
                        this.consumableActualConsumed[trackingKey] = {};
                        this.trackingStartTime[trackingKey] = Date.now();
                    }

                    // Calculate time elapsed since we started tracking
                    const trackingStartTime = this.trackingStartTime[trackingKey] || Date.now();
                    const elapsedSeconds = (Date.now() - trackingStartTime) / 1000;

                    // Process consumables using event-based consumption data
                    const consumablesWithConsumed = [];
                    const seenItems = new Set(); // Deduplicate by itemHrid (game allows 1 of each type)

                    if (player.combatConsumables) {
                        for (const consumable of player.combatConsumables) {
                            // Skip duplicate entries (game UI enforces 1 per type, but WS data may have dupes)
                            if (seenItems.has(consumable.itemHrid)) {
                                continue;
                            }
                            seenItems.add(consumable.itemHrid);

                            // Get actual consumed count from consumption events
                            const totalActualConsumed =
                                this.consumableActualConsumed[trackingKey]?.[consumable.itemHrid] || 0;

                            // MCS-style baseline: fixed item counts (not rates)
                            // Baseline assumes 2 drinks or 10 foods consumed in DEFAULT_TIME (600s)
                            const itemName = consumable.itemHrid.toLowerCase();
                            const isDrink = itemName.includes('coffee') || itemName.includes('drink');
                            const isFood =
                                itemName.includes('donut') ||
                                itemName.includes('cupcake') ||
                                itemName.includes('cake') ||
                                itemName.includes('gummy') ||
                                itemName.includes('yogurt');

                            const defaultConsumed = isDrink ? 2 : isFood ? 10 : 0;

                            // MCS-style weighted average with DEFAULT_TIME constant
                            // Adds 10 minutes (600s) of baseline data to make estimates stable from start
                            const DEFAULT_TIME = 10 * 60; // 600 seconds
                            const baselineRate = defaultConsumed / DEFAULT_TIME;

                            let consumptionRate;
                            if (totalActualConsumed === 0) {
                                // No consumption detected yet — use pure baseline rate
                                consumptionRate = baselineRate;
                            } else {
                                // Blend actual data with baseline for stability
                                const actualRate = totalActualConsumed / elapsedSeconds;
                                const combinedTotal = defaultConsumed + totalActualConsumed;
                                const combinedTime = DEFAULT_TIME + elapsedSeconds;
                                const combinedRate = combinedTotal / combinedTime;
                                // 90% actual rate + 10% combined (baseline+actual) rate
                                consumptionRate = actualRate * 0.9 + combinedRate * 0.1;
                            }

                            // Estimate total consumed for the entire combat duration
                            const estimatedConsumed = consumptionRate * durationSeconds;

                            consumablesWithConsumed.push({
                                itemHrid: consumable.itemHrid,
                                currentCount: consumable.count,
                                actualConsumed: totalActualConsumed,
                                consumed: estimatedConsumed,
                                consumptionRate: consumptionRate,
                                elapsedSeconds: elapsedSeconds,
                            });
                        }
                    }

                    return {
                        name: player.character.name,
                        characterId: characterId,
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

            // Store in IndexedDB (debounced - will update continuously during combat)
            await storage.setJSON('latestCombatRun', combatData, 'combatStats');
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
        this.consumableActualConsumed = {};
        this.trackingStartTime = {};
    }
}

const combatStatsDataCollector = new CombatStatsDataCollector();

export default combatStatsDataCollector;
