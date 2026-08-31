import { getGameData } from './game-data.js';

class SimResult {
    constructor(zone, numberOfPlayers) {
        this.deaths = {};
        this.experienceGained = {};
        this.encounters = 0;
        this.attacks = {};
        this.consumablesUsed = {};
        this.hitpointsGained = {};
        this.manapointsGained = {};
        this.debuffOnLevelGap = {};
        this.dropRateMultiplier = {};
        this.rareFindMultiplier = {};
        this.combatDropQuantity = {};
        this.playerRanOutOfMana = {
            player1: false,
            player2: false,
            player3: false,
            player4: false,
            player5: false,
        };
        this.playerRanOutOfManaTime = {};
        this.manaUsed = {};
        this.timeSpentAlive = [];
        this.bossSpawns = [];
        this.hitpointsSpent = {};
        this.zoneName = zone.hrid;
        this.difficultyTier = zone.difficultyTier;
        this.isDungeon = false;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.maxWaveReached = 0;
        this.numberOfPlayers = numberOfPlayers;
        this.maxEnrageStack = 0;

        this.wipeEvents = [];
        this.totalDamageDealt = {}; // sourceHrid → total damage dealt

        // Kill-time-context drop accounting (CSIM-AUD-011): per-monster, per-player running sums
        // of each player's drop-rate/rare-find/quantity multiplier AT THE MOMENT of each kill,
        // rather than a single end-of-simulation snapshot applied retroactively to every kill.
        // { [monsterHrid]: { killCount, byPlayer: { [playerHrid]: { sumDropRateMultiplier, sumRareFindMultiplier, sumCombatDropQuantity } } } }
        this.killDropContext = {};
        // Same idea for dungeon completion rewards, which only use combatDropQuantity.
        this.dungeonCompletionDropContext = { count: 0, byPlayer: {} };
    }

    addWipeEvent(logs, simulationTime, wave) {
        this.wipeEvents.push({
            simulationTime: simulationTime,
            logs: logs,
            wave: wave,
            timestamp: new Date().toISOString(),
        });
    }

    addDeath(unit) {
        if (!this.deaths[unit.hrid]) {
            this.deaths[unit.hrid] = 0;
        }

        this.deaths[unit.hrid] += 1;
    }

    /**
     * Accumulate each player's drop-rate/rare-find/quantity multiplier AT THE MOMENT this monster
     * died (CSIM-AUD-011), instead of relying solely on a single end-of-simulation snapshot
     * applied retroactively to every kill regardless of when temporary buffs/scrolls were active.
     * @param {string} monsterHrid
     * @param {Array<Player>} players
     */
    recordMonsterKill(monsterHrid, players) {
        if (!this.killDropContext[monsterHrid]) {
            this.killDropContext[monsterHrid] = { killCount: 0, byPlayer: {} };
        }
        const entry = this.killDropContext[monsterHrid];
        entry.killCount += 1;

        for (const player of players || []) {
            if (!player) continue;
            if (!entry.byPlayer[player.hrid]) {
                entry.byPlayer[player.hrid] = {
                    sumDropRateMultiplier: 0,
                    sumRareFindMultiplier: 0,
                    sumCombatDropQuantity: 0,
                };
            }
            const stats = player.combatDetails.combatStats;
            entry.byPlayer[player.hrid].sumDropRateMultiplier += 1 + stats.combatDropRate;
            entry.byPlayer[player.hrid].sumRareFindMultiplier += 1 + stats.combatRareFind;
            entry.byPlayer[player.hrid].sumCombatDropQuantity += stats.combatDropQuantity;
        }
    }

    /**
     * Same kill-time-context accounting as recordMonsterKill(), for dungeon completion rewards
     * (which only use combatDropQuantity, not per-monster drop-rate/rare-find).
     * @param {Array<Player>} players
     */
    recordDungeonCompletion(players) {
        this.dungeonCompletionDropContext.count += 1;

        for (const player of players || []) {
            if (!player) continue;
            if (!this.dungeonCompletionDropContext.byPlayer[player.hrid]) {
                this.dungeonCompletionDropContext.byPlayer[player.hrid] = { sumCombatDropQuantity: 0 };
            }
            this.dungeonCompletionDropContext.byPlayer[player.hrid].sumCombatDropQuantity +=
                player.combatDetails.combatStats.combatDropQuantity;
        }
    }

    updateTimeSpentAlive(name, alive, time) {
        const i = this.timeSpentAlive.findIndex((e) => e.name === name);
        if (alive) {
            if (i !== -1) {
                this.timeSpentAlive[i].alive = true;
                this.timeSpentAlive[i].spawnedAt = time;
            } else {
                this.timeSpentAlive.push({ name: name, timeSpentAlive: 0, spawnedAt: time, alive: true, count: 0 });
            }
        } else {
            const timeAlive = time - this.timeSpentAlive[i].spawnedAt;
            this.timeSpentAlive[i].alive = false;
            this.timeSpentAlive[i].timeSpentAlive += timeAlive;
            this.timeSpentAlive[i].count += 1;
        }
    }

    addExperienceGain(unit, experience) {
        if (!unit.isPlayer) {
            return;
        }

        if (!this.experienceGained[unit.hrid]) {
            this.experienceGained[unit.hrid] = {
                stamina: 0,
                intelligence: 0,
                attack: 0,
                melee: 0,
                defense: 0,
                ranged: 0,
                magic: 0,
            };
        }

        const experienceGainedRate = {
            stamina: 0,
            intelligence: 0,
            attack: 0,
            melee: 0,
            defense: 0,
            ranged: 0,
            magic: 0,
        };

        const primaryTraining = unit.combatDetails.combatStats.primaryTraining;
        experienceGainedRate[primaryTraining.split('/')[2]] = 0.3;

        const combatStyleDetailMap = getGameData().combatStyleDetailMap;
        const skillExpMap = combatStyleDetailMap[unit.combatDetails.combatStats.combatStyleHrid].skillExpMap;
        const skillExpMapLength = Object.keys(skillExpMap).length;

        const focusTraining = unit.combatDetails.combatStats.focusTraining;
        if (focusTraining && skillExpMap[focusTraining]) {
            experienceGainedRate[focusTraining.split('/')[2]] += 0.7;
        } else {
            Object.keys(skillExpMap).forEach((skillHrid) => {
                experienceGainedRate[skillHrid.split('/')[2]] += 0.7 / skillExpMapLength;
            });
        }

        for (const [type, rate] of Object.entries(experienceGainedRate)) {
            if (rate <= 0) continue;

            const skillExperience = rate * (1 + unit.combatDetails.combatStats[type + 'Experience']);

            this.experienceGained[unit.hrid][type] +=
                experience *
                (1 + unit.combatDetails.combatStats.combatExperience) *
                skillExperience *
                (1 + unit.debuffOnLevelGap);
        }
    }

    addEncounterEnd() {
        this.encounters++;
    }

    addAttack(source, target, ability, hit) {
        if (!this.attacks[source.hrid]) {
            this.attacks[source.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid]) {
            this.attacks[source.hrid][target.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid][ability]) {
            this.attacks[source.hrid][target.hrid][ability] = {};
        }

        if (!this.attacks[source.hrid][target.hrid][ability][hit]) {
            this.attacks[source.hrid][target.hrid][ability][hit] = 0;
        }

        this.attacks[source.hrid][target.hrid][ability][hit] += 1;

        if (hit !== 'miss') {
            this.totalDamageDealt[source.hrid] = (this.totalDamageDealt[source.hrid] || 0) + hit;
        }
    }

    addConsumableUse(unit, consumable) {
        if (!this.consumablesUsed[unit.hrid]) {
            this.consumablesUsed[unit.hrid] = {};
        }
        if (!this.consumablesUsed[unit.hrid][consumable.hrid]) {
            this.consumablesUsed[unit.hrid][consumable.hrid] = 0;
        }

        this.consumablesUsed[unit.hrid][consumable.hrid] += 1;
    }

    addHitpointsGained(unit, source, amount) {
        if (!this.hitpointsGained[unit.hrid]) {
            this.hitpointsGained[unit.hrid] = {};
        }
        if (!this.hitpointsGained[unit.hrid][source]) {
            this.hitpointsGained[unit.hrid][source] = 0;
        }

        this.hitpointsGained[unit.hrid][source] += amount;
    }

    addManapointsGained(unit, source, amount) {
        if (!this.manapointsGained[unit.hrid]) {
            this.manapointsGained[unit.hrid] = {};
        }
        if (!this.manapointsGained[unit.hrid][source]) {
            this.manapointsGained[unit.hrid][source] = 0;
        }

        this.manapointsGained[unit.hrid][source] += amount;
    }

    setDropRateMultipliers(unit) {
        if (!this.dropRateMultiplier[unit.hrid]) {
            this.dropRateMultiplier[unit.hrid] = {};
        }
        this.dropRateMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatDropRate;

        if (!this.rareFindMultiplier[unit.hrid]) {
            this.rareFindMultiplier[unit.hrid] = {};
        }
        this.rareFindMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatRareFind;

        if (!this.combatDropQuantity[unit.hrid]) {
            this.combatDropQuantity[unit.hrid] = {};
        }
        this.combatDropQuantity[unit.hrid] = unit.combatDetails.combatStats.combatDropQuantity;

        if (!this.debuffOnLevelGap[unit.hrid]) {
            this.debuffOnLevelGap[unit.hrid] = {};
        }
        this.debuffOnLevelGap[unit.hrid] = unit.debuffOnLevelGap;
    }

    setManaUsed(unit) {
        this.manaUsed[unit.hrid] = {};
        for (const [key, value] of unit.abilityManaCosts.entries()) {
            this.manaUsed[unit.hrid][key] = value;
        }
    }

    addHitpointsSpent(unit, source, amount) {
        if (!this.hitpointsSpent[unit.hrid]) {
            this.hitpointsSpent[unit.hrid] = {};
        }
        if (!this.hitpointsSpent[unit.hrid][source]) {
            this.hitpointsSpent[unit.hrid][source] = 0;
        }

        this.hitpointsSpent[unit.hrid][source] += amount;
    }

    addRanOutOfManaCount(unit, isOutOfMana, time) {
        if (isOutOfMana) this.playerRanOutOfMana[unit.hrid] = true;

        if (!this.playerRanOutOfManaTime[unit.hrid]) {
            this.playerRanOutOfManaTime[unit.hrid] = {
                isOutOfMana: false,
                startTimeForOutOfMana: 0,
                totalTimeForOutOfMana: 0,
            };
        }

        if (isOutOfMana) {
            if (!this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
                this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = true;
                this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana = time;
            }
        } else if (this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
            this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = false;
            this.playerRanOutOfManaTime[unit.hrid].totalTimeForOutOfMana +=
                time - this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana;
        }
    }
}

export default SimResult;
