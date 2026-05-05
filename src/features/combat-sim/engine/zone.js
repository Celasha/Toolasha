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

        // Log zone construction state for debugging
        console.log('[Zone] constructed:', {
            hrid: this.hrid,
            difficultyTier: this.difficultyTier,
            isDungeon: this.isDungeon,
            hasFightInfo: !!this.monsterSpawnInfo,
            hasDungeonInfo: !!this.dungeonSpawnInfo,
            hasRandomSpawnInfo: !!this.monsterSpawnInfo?.randomSpawnInfo,
            hasRandomSpawnInfoSpawns: !!this.monsterSpawnInfo?.randomSpawnInfo?.spawns,
            randomSpawnInfoSpawnsLength: this.monsterSpawnInfo?.randomSpawnInfo?.spawns?.length ?? 'N/A',
            hasBossSpawns: !!this.monsterSpawnInfo?.bossSpawns,
            hasDungeonRandomSpawnInfoMap: !!this.dungeonSpawnInfo?.randomSpawnInfoMap,
            dungeonRandomSpawnInfoMapKeys: this.dungeonSpawnInfo?.randomSpawnInfoMap
                ? Object.keys(this.dungeonSpawnInfo.randomSpawnInfoMap)
                : 'N/A',
            fixedSpawnsMapKeys: this.dungeonSpawnInfo?.fixedSpawnsMap
                ? Object.keys(this.dungeonSpawnInfo.fixedSpawnsMap)
                : 'N/A',
            maxWaves: this.dungeonSpawnInfo?.maxWaves ?? 'N/A',
            combatZoneInfoKeys: Object.keys(gameZone.combatZoneInfo),
        });

        if (this.monsterSpawnInfo) {
            this.monsterSpawnInfo.battlesPerBoss = 10;
        }
    }

    getRandomEncounter() {
        // Guard: if monsterSpawnInfo is missing entirely
        if (!this.monsterSpawnInfo) {
            console.error('[Zone] getRandomEncounter CRASH DEBUG:', {
                reason: 'monsterSpawnInfo is null/undefined',
                zoneHrid: this.hrid,
                isDungeon: this.isDungeon,
                difficultyTier: this.difficultyTier,
                encountersKilled: this.encountersKilled,
            });
            return [];
        }

        if (this.monsterSpawnInfo.bossSpawns && this.encountersKilled === this.monsterSpawnInfo.battlesPerBoss) {
            this.encountersKilled = 1;
            return this.monsterSpawnInfo.bossSpawns.map(
                (monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier)
            );
        }

        // Guard: if randomSpawnInfo or spawns is missing
        if (!this.monsterSpawnInfo.randomSpawnInfo || !this.monsterSpawnInfo.randomSpawnInfo.spawns) {
            console.error('[Zone] getRandomEncounter CRASH DEBUG:', {
                reason: 'randomSpawnInfo or spawns is null/undefined',
                zoneHrid: this.hrid,
                isDungeon: this.isDungeon,
                difficultyTier: this.difficultyTier,
                encountersKilled: this.encountersKilled,
                dungeonsCompleted: this.dungeonsCompleted,
                dungeonsFailed: this.dungeonsFailed,
                monsterSpawnInfoKeys: Object.keys(this.monsterSpawnInfo),
                randomSpawnInfo: this.monsterSpawnInfo.randomSpawnInfo
                    ? JSON.parse(JSON.stringify(this.monsterSpawnInfo.randomSpawnInfo))
                    : null,
                hasDungeonSpawnInfo: !!this.dungeonSpawnInfo,
                dungeonSpawnInfoMaxWaves: this.dungeonSpawnInfo?.maxWaves ?? 'N/A',
                fullMonsterSpawnInfo: JSON.parse(JSON.stringify(this.monsterSpawnInfo)),
            });
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
            console.error('[Zone] getNextWave CRASH DEBUG:', {
                reason: 'randomSpawnInfoMap is null/undefined/not-object',
                randomSpawnInfoMap,
                zoneHrid: this.hrid,
                waveNum,
                maxWaves: this.dungeonSpawnInfo.maxWaves,
                fixedSpawnsMapKeys: Object.keys(this.dungeonSpawnInfo.fixedSpawnsMap || {}),
                dungeonSpawnInfo: JSON.parse(JSON.stringify(this.dungeonSpawnInfo)),
            });
            this.encountersKilled++;
            return [];
        }

        const waveKeys = Object.keys(randomSpawnInfoMap)
            .map(Number)
            .sort((a, b) => a - b);

        if (waveKeys.length === 0) {
            console.error('[Zone] getNextWave CRASH DEBUG:', {
                reason: 'randomSpawnInfoMap has no keys',
                randomSpawnInfoMap: JSON.parse(JSON.stringify(randomSpawnInfoMap)),
                zoneHrid: this.hrid,
                waveNum,
                maxWaves: this.dungeonSpawnInfo.maxWaves,
                fixedSpawnsMapKeys: Object.keys(this.dungeonSpawnInfo.fixedSpawnsMap || {}),
            });
            this.encountersKilled++;
            return [];
        }

        let monsterSpawns = null;
        let matchReason = 'none';

        if (waveNum >= waveKeys[waveKeys.length - 1]) {
            monsterSpawns = randomSpawnInfoMap[waveKeys[waveKeys.length - 1]];
            matchReason = `>= last key (${waveKeys[waveKeys.length - 1]})`;
        } else {
            for (let i = 0; i < waveKeys.length - 1; i++) {
                if (waveNum >= waveKeys[i] && waveNum < waveKeys[i + 1]) {
                    monsterSpawns = randomSpawnInfoMap[waveKeys[i]];
                    matchReason = `range [${waveKeys[i]}, ${waveKeys[i + 1]})`;
                    break;
                }
            }
        }

        // Fallback to first available spawn info if no range matched
        if (!monsterSpawns || !monsterSpawns.spawns) {
            const fallbackKey = waveKeys[0];
            const fallbackValue = randomSpawnInfoMap[fallbackKey];

            console.error('[Zone] getNextWave CRASH DEBUG:', {
                reason: 'monsterSpawns null/missing spawns after lookup',
                matchReason,
                monsterSpawns: monsterSpawns ? JSON.parse(JSON.stringify(monsterSpawns)) : monsterSpawns,
                fallbackKey,
                fallbackValue: fallbackValue
                    ? { spawns: fallbackValue.spawns, maxSpawnCount: fallbackValue.maxSpawnCount }
                    : fallbackValue,
                zoneHrid: this.hrid,
                waveNum,
                maxWaves: this.dungeonSpawnInfo.maxWaves,
                waveKeys,
                fixedSpawnsMapKeys: Object.keys(this.dungeonSpawnInfo.fixedSpawnsMap || {}),
                dungeonsCompleted: this.dungeonsCompleted,
                dungeonsFailed: this.dungeonsFailed,
                randomSpawnInfoMapSnapshot: JSON.parse(JSON.stringify(randomSpawnInfoMap)),
            });

            monsterSpawns = fallbackValue;
        }

        // Final safety — if still broken, skip wave instead of crashing
        if (!monsterSpawns?.spawns) {
            console.error('[Zone] getNextWave FATAL: no valid spawns found anywhere, skipping wave', {
                zoneHrid: this.hrid,
                waveNum,
            });
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
