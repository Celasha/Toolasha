import { getGameData } from './game-data.js';
import Monster from './monster.js';

class Zone {
    constructor(hrid, difficultyTier) {
        this.hrid = hrid;
        this.difficultyTier = difficultyTier;

        const actionDetailMap = getGameData().actionDetailMap;
        const gameZone = actionDetailMap[this.hrid];
        this.monsterSpawnInfo = gameZone.combatZoneInfo.fightInfo;
        this.dungeonSpawnInfo = gameZone.combatZoneInfo.dungeonInfo;
        this.encountersKilled = 1;
        this.buffs = gameZone.buffs;
        this.isDungeon = gameZone.combatZoneInfo.isDungeon;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.finalWave = false;

        if (this.monsterSpawnInfo) {
            this.monsterSpawnInfo.battlesPerBoss = 10;
        }
    }

    getRandomEncounter() {
        if (!this.monsterSpawnInfo) {
            return [];
        }

        if (this.monsterSpawnInfo.bossSpawns && this.encountersKilled === this.monsterSpawnInfo.battlesPerBoss) {
            this.encountersKilled = 1;
            return this.monsterSpawnInfo.bossSpawns.map(
                (monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier)
            );
        }

        if (!this.monsterSpawnInfo.randomSpawnInfo || !this.monsterSpawnInfo.randomSpawnInfo.spawns) {
            this.encountersKilled++;
            return [];
        }

        const totalWeight = this.monsterSpawnInfo.randomSpawnInfo.spawns.reduce((prev, cur) => prev + cur.rate, 0);

        const encounterHrids = [];
        let totalStrength = 0;

        outer: for (let i = 0; i < this.monsterSpawnInfo.randomSpawnInfo.maxSpawnCount; i++) {
            const randomWeight = totalWeight * Math.random();
            let cumulativeWeight = 0;

            for (const spawn of this.monsterSpawnInfo.randomSpawnInfo.spawns) {
                cumulativeWeight += spawn.rate;
                if (randomWeight <= cumulativeWeight) {
                    totalStrength += spawn.strength;

                    if (totalStrength <= this.monsterSpawnInfo.randomSpawnInfo.maxTotalStrength) {
                        encounterHrids.push({ hrid: spawn.combatMonsterHrid, difficultyTier: spawn.difficultyTier });
                    } else {
                        break outer;
                    }
                    break;
                }
            }
        }
        this.encountersKilled++;
        return encounterHrids.map((hrid) => new Monster(hrid.hrid, hrid.difficultyTier + this.difficultyTier));
    }

    failWave() {
        this.dungeonsFailed++;
        this.encountersKilled = 1;
    }

    getNextWave() {
        if (this.encountersKilled > this.dungeonSpawnInfo.maxWaves) {
            this.dungeonsCompleted++;
            this.encountersKilled = 1;
        }

        const waveNum = this.encountersKilled;
        const fixedSpawns = this.dungeonSpawnInfo.fixedSpawnsMap[waveNum.toString()];

        if (fixedSpawns) {
            this.encountersKilled++;
            return fixedSpawns.map(
                (monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier)
            );
        }

        // Random spawn path
        const randomSpawnInfoMap = this.dungeonSpawnInfo.randomSpawnInfoMap;

        if (!randomSpawnInfoMap || typeof randomSpawnInfoMap !== 'object') {
            this.encountersKilled++;
            return [];
        }

        const waveKeys = Object.keys(randomSpawnInfoMap)
            .map(Number)
            .sort((a, b) => a - b);

        if (waveKeys.length === 0) {
            this.encountersKilled++;
            return [];
        }

        let monsterSpawns = null;

        if (waveNum >= waveKeys[waveKeys.length - 1]) {
            monsterSpawns = randomSpawnInfoMap[waveKeys[waveKeys.length - 1]];
        } else {
            for (let i = 0; i < waveKeys.length - 1; i++) {
                if (waveNum >= waveKeys[i] && waveNum < waveKeys[i + 1]) {
                    monsterSpawns = randomSpawnInfoMap[waveKeys[i]];
                    break;
                }
            }
        }

        // Fallback to first available spawn info if no range matched
        if (!monsterSpawns || !monsterSpawns.spawns) {
            monsterSpawns = randomSpawnInfoMap[waveKeys[0]];
        }

        // Final safety — if still broken, skip wave instead of crashing
        if (!monsterSpawns?.spawns) {
            this.encountersKilled++;
            return [];
        }

        const totalWeight = monsterSpawns.spawns.reduce((prev, cur) => prev + cur.rate, 0);

        const encounterHrids = [];
        let totalStrength = 0;

        outer: for (let i = 0; i < monsterSpawns.maxSpawnCount; i++) {
            const randomWeight = totalWeight * Math.random();
            let cumulativeWeight = 0;

            for (const spawn of monsterSpawns.spawns) {
                cumulativeWeight += spawn.rate;
                if (randomWeight <= cumulativeWeight) {
                    totalStrength += spawn.strength;

                    if (totalStrength <= monsterSpawns.maxTotalStrength) {
                        encounterHrids.push({
                            hrid: spawn.combatMonsterHrid,
                            difficultyTier: spawn.difficultyTier,
                        });
                    } else {
                        break outer;
                    }
                    break;
                }
            }
        }
        this.encountersKilled++;
        return encounterHrids.map((hrid) => new Monster(hrid.hrid, hrid.difficultyTier + this.difficultyTier));
    }
}

export default Zone;
