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
        this.latestCombatData = null;
        this.currentBattleId = null;
        this.consumablePreviousCount = {}; // { characterId: { itemHrid: previousCount } } - for detecting drops
        this.consumableTotalConsumed = {}; // { characterId: { itemHrid: totalConsumed } } - accumulated consumption
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

        // Store handler reference for cleanup
        this.newBattleHandler = (data) => this.onNewBattle(data);

        // Listen for new_battle messages (fires during combat, continuously updated)
        webSocketHook.on('new_battle', this.newBattleHandler);
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
                players: data.players.map((player) => {
                    const characterId = player.character.id;

                    // Initialize tracking for this character if needed
                    if (!this.consumablePreviousCount[characterId]) {
                        this.consumablePreviousCount[characterId] = {};
                        this.consumableTotalConsumed[characterId] = {};
                        this.trackingStartTime[characterId] = Date.now();
                    }

                    // Calculate time elapsed since we started tracking
                    const trackingStartTime = this.trackingStartTime[characterId] || Date.now();
                    const elapsedSeconds = (Date.now() - trackingStartTime) / 1000;

                    // Process consumables - detect drops and accumulate consumption
                    const consumablesWithConsumed = [];
                    if (player.combatConsumables) {
                        for (const consumable of player.combatConsumables) {
                            const currentCount = consumable.count;
                            const previousCount = this.consumablePreviousCount[characterId][consumable.itemHrid];

                            // Detect consumption (inventory drop)
                            if (previousCount !== undefined && currentCount < previousCount) {
                                const consumed = previousCount - currentCount;
                                this.consumableTotalConsumed[characterId][consumable.itemHrid] =
                                    (this.consumableTotalConsumed[characterId][consumable.itemHrid] || 0) + consumed;
                            }

                            // Update previous count for next comparison
                            this.consumablePreviousCount[characterId][consumable.itemHrid] = currentCount;

                            // Get total consumed for this item
                            const totalActualConsumed =
                                this.consumableTotalConsumed[characterId][consumable.itemHrid] || 0;

                            // Calculate baseline consumption rate based on item type (matching Edible Tools)
                            const itemName = consumable.itemHrid.toLowerCase();
                            const isDrink = itemName.includes('coffee') || itemName.includes('drink');
                            const isDonutOrCake = itemName.includes('donut') || itemName.includes('cake');
                            const isGummyOrYogurt = itemName.includes('gummy') || itemName.includes('yogurt');

                            let baselineRate;
                            if (isDrink) {
                                // Coffees: 300 / (1 + drinkConcentration) seconds per coffee
                                const drinkConcentration = player.combatDetails?.combatStats?.drinkConcentration || 0;
                                const secondsPerCoffee = 300 / (1 + drinkConcentration);
                                baselineRate = 1 / secondsPerCoffee;
                            } else if (isDonutOrCake) {
                                // Donut/Cake: 75 seconds
                                baselineRate = 1 / 75;
                            } else if (isGummyOrYogurt) {
                                // Gummy/Yogurt: 67 seconds
                                baselineRate = 1 / 67;
                            } else {
                                // Default food: 60 seconds
                                baselineRate = 1 / 60;
                            }

                            let consumptionRate;

                            // If we have insufficient actual data, use 100% baseline
                            // Otherwise use weighted average (90% actual, 10% baseline)
                            if (elapsedSeconds < 60 || totalActualConsumed === 0) {
                                // Not enough data yet, use pure baseline
                                consumptionRate = baselineRate;
                            } else {
                                // Enough data, use weighted average
                                const actualRate = totalActualConsumed / elapsedSeconds;
                                // 90% actual data + 10% baseline
                                consumptionRate = actualRate * 0.9 + baselineRate * 0.1;
                            }

                            // Estimate total consumed for the entire combat duration
                            const estimatedConsumed = consumptionRate * durationSeconds;

                            consumablesWithConsumed.push({
                                itemHrid: consumable.itemHrid,
                                currentCount: currentCount,
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

        this.isInitialized = false;
        this.latestCombatData = null;
        this.currentBattleId = null;
        this.consumablePreviousCount = {};
        this.consumableTotalConsumed = {};
        this.trackingStartTime = {};
    }
}

// Create and export singleton instance
const combatStatsDataCollector = new CombatStatsDataCollector();

export default combatStatsDataCollector;
