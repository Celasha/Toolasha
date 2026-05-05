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
        this.monsterSpawnInfo.battlesPerBoss = 10;
        this.buffs = gameZone.buffs;
        this.isDungeon = gameZone.combatZoneInfo.isDungeon;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.finalWave = false;
    }

    getRandomEncounter() {
        if (this.monsterSpawnInfo.bossSpawns && this.encountersKilled === this.monsterSpawnInfo.battlesPerBoss) {
            this.encountersKilled = 1;
            return this.monsterSpawnInfo.bossSpawns.map(
                (monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier)
            );
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
        // console.log("Wave #" + this.encountersKilled);
        if (this.dungeonSpawnInfo.fixedSpawnsMap.hasOwnProperty(this.encountersKilled.toString())) {
            const currentMonsters = this.dungeonSpawnInfo.fixedSpawnsMap[this.encountersKilled.toString()];
            this.encountersKilled++;
            return currentMonsters.map(
                (monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier)
            );
        } else {
            let monsterSpawns = {};
            const waveKeys = Object.keys(this.dungeonSpawnInfo.randomSpawnInfoMap)
                .map(Number)
                .sort((a, b) => a - b);
            if (this.encountersKilled >= waveKeys[waveKeys.length - 1]) {
                monsterSpawns = this.dungeonSpawnInfo.randomSpawnInfoMap[waveKeys[waveKeys.length - 1]];
            } else {
                for (let i = 0; i < waveKeys.length - 1; i++) {
                    if (this.encountersKilled >= waveKeys[i] && this.encountersKilled <= waveKeys[i + 1]) {
                        monsterSpawns = this.dungeonSpawnInfo.randomSpawnInfoMap[waveKeys[i]];
                        break;
                    }
                }
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
}

export default Zone;
