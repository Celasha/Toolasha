import { describe, expect, test } from 'vitest';
import CombatSimulator from './combat-simulator.js';
import CombatUnit from './combat-unit.js';
import CombatStartEvent from './events/combat-start-event.js';

function makeSimulator() {
    return new CombatSimulator([], { hrid: '/actions/combat/test_zone', difficultyTier: 0 }, null, null);
}

function makeUnit() {
    const unit = new CombatUnit();
    unit.isPlayer = true;
    return unit;
}

describe('CombatSimulator._processFuryUpdate - fractional miss decay (CSIM-AUD-003)', () => {
    test('a miss halves the current stack without flooring: 5 -> 2.5', () => {
        const simulator = makeSimulator();
        const unit = makeUnit();
        unit.furyAmount = 5;

        simulator._processFuryUpdate(unit, false);

        expect(unit.furyAmount).toBe(2.5);
    });

    test('a miss halves the current stack without flooring: 3 -> 1.5', () => {
        const simulator = makeSimulator();
        const unit = makeUnit();
        unit.furyAmount = 3;

        simulator._processFuryUpdate(unit, false);

        expect(unit.furyAmount).toBe(1.5);
    });

    test('a further miss keeps decaying fractionally: 1.5 -> 0.75', () => {
        const simulator = makeSimulator();
        const unit = makeUnit();
        unit.furyAmount = 1.5;

        simulator._processFuryUpdate(unit, false);

        expect(unit.furyAmount).toBe(0.75);
    });

    test('a hit still caps at MAX_FURY_STACK = 5 (protected)', () => {
        const simulator = makeSimulator();
        const unit = makeUnit();
        unit.furyAmount = 5;

        simulator._processFuryUpdate(unit, true);

        expect(unit.furyAmount).toBe(5);
    });

    test('a hit from 0 increments by 1', () => {
        const simulator = makeSimulator();
        const unit = makeUnit();
        unit.furyAmount = 0;

        simulator._processFuryUpdate(unit, true);

        expect(unit.furyAmount).toBe(1);
    });
});

describe('CombatSimulator._rescheduleSurvivingBuffExpirations - death/revive timed-buff expiry (CSIM-AUD-004)', () => {
    test('a still-active timed buff gets a fresh CheckBuffExpirationEvent at its original absolute expiry', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 1000;
        const unit = makeUnit();
        unit.combatBuffs['/buff_uniques/test_buff'] = {
            uniqueHrid: '/buff_uniques/test_buff',
            typeHrid: '/buff_types/damage',
            startTime: 500,
            duration: 1000, // absolute expiry = 1500, 500ns remaining from simulationTime=1000
        };

        simulator._rescheduleSurvivingBuffExpirations(unit);

        const scheduled = simulator.eventQueue.minHeap.data;
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].source).toBe(unit);
        expect(scheduled[0].time).toBe(1500);
    });

    test('an already-expired buff does not get rescheduled', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 2000;
        const unit = makeUnit();
        unit.combatBuffs['/buff_uniques/test_buff'] = {
            uniqueHrid: '/buff_uniques/test_buff',
            typeHrid: '/buff_types/damage',
            startTime: 500,
            duration: 1000, // absolute expiry = 1500, already in the past relative to time 2000
        };

        simulator._rescheduleSurvivingBuffExpirations(unit);

        expect(simulator.eventQueue.minHeap.data).toHaveLength(0);
    });

    test('a buff with a non-finite startTime (e.g. Enrage, out of TLA-029 scope) is skipped, not rescheduled or thrown on', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 1000;
        const unit = makeUnit();
        unit.combatBuffs['/buff_uniques/enrage_damage'] = {
            uniqueHrid: '/buff_uniques/enrage_damage',
            typeHrid: '/buff_types/damage',
            startTime: undefined,
            duration: 1000,
        };

        expect(() => simulator._rescheduleSurvivingBuffExpirations(unit)).not.toThrow();
        expect(simulator.eventQueue.minHeap.data).toHaveLength(0);
    });

    test('no duplicate expiry events for multiple surviving buffs with distinct expiries', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 1000;
        const unit = makeUnit();
        unit.combatBuffs['/buff_uniques/a'] = { startTime: 900, duration: 200 }; // expiry 1100
        unit.combatBuffs['/buff_uniques/b'] = { startTime: 800, duration: 500 }; // expiry 1300

        simulator._rescheduleSurvivingBuffExpirations(unit);

        const times = simulator.eventQueue.minHeap.data.map((event) => event.time).sort((a, b) => a - b);
        expect(times).toEqual([1100, 1300]);
    });
});

describe('CombatSimulator.processAbilityBuffEffect - official Aura routing (CSIM-AUD-001)', () => {
    function makeAllAlliesAbility(hrid, buffOverrides = {}) {
        return {
            ability: { hrid, isSpecialAbility: true },
            effect: {
                targetType: 'allAllies',
                buffs: [
                    {
                        uniqueHrid: '/buff_uniques/speed_aura_attack_speed',
                        typeHrid: '/buff_types/attack_speed',
                        ratioBoost: 0.3,
                        flatBoost: 0,
                        duration: 120000000000,
                        ...buffOverrides,
                    },
                ],
            },
        };
    }

    test('an official Aura ability routes through addAuraBuff (strongest-source registry)', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const caster = makeUnit();
        caster.hrid = 'player1';
        caster.combatDetails.attackLevel = 0;
        const target = makeUnit();
        target.hrid = 'player2';
        simulator.players = [caster, target];

        const { ability, effect } = makeAllAlliesAbility('/abilities/speed_aura');
        simulator.processAbilityBuffEffect(caster, ability, effect);

        expect(target.auraSources['/buff_uniques/speed_aura_attack_speed']).toBeDefined();
        expect(target.auraSources['/buff_uniques/speed_aura_attack_speed']['player1']).toBeDefined();
    });

    test('a non-Aura allAllies ability keeps ordinary last-write addBuff semantics (not routed through auraSources)', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const caster = makeUnit();
        caster.hrid = 'player1';
        const target = makeUnit();
        target.hrid = 'player2';
        simulator.players = [caster, target];

        const { ability, effect } = makeAllAlliesAbility('/abilities/some_other_party_buff');
        simulator.processAbilityBuffEffect(caster, ability, effect);

        expect(target.auraSources['/buff_uniques/speed_aura_attack_speed']).toBeUndefined();
        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeDefined();
    });
});

describe('CombatSimulator personal combat buff lifetime (CSIM-AUD-019, TLA-039 defect C: independent per-buff lifetimes)', () => {
    test('PB-04/no expiry evidence keeps that personal buff permanent (status quo)', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const player = makeUnit();
        player.personalCombatBuffs = {
            buffs: [
                { buff: { typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 }, remainingDurationNs: null },
            ],
        };

        simulator._applyPersonalPermanentCombatBuffs(player);

        expect(player.permanentBuffs['/buff_types/wisdom'].flatBoost).toBeCloseTo(0.05);
        expect(simulator.eventQueue.minHeap.data).toHaveLength(0);
    });

    test('PB-01: a known remaining lifetime is modeled as a timed buff that expires on the simulation timeline, not permanently', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const player = makeUnit();
        player.personalCombatBuffs = {
            buffs: [
                {
                    buff: { typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 },
                    remainingDurationNs: 600_000_000_000, // 10 minutes in ns
                },
            ],
        };

        simulator._applyPersonalTimedCombatBuffs(player);

        const buff = Object.values(player.combatBuffs).find((b) => b.typeHrid === '/buff_types/wisdom');
        expect(buff).toBeDefined();
        expect(buff.duration).toBe(600_000_000_000);
        expect(player.permanentBuffs['/buff_types/wisdom']).toBeUndefined();

        const scheduled = simulator.eventQueue.minHeap.data;
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].time).toBe(600_000_000_000);

        // Expiry actually removes it once the scheduled time is reached.
        player.removeExpiredBuffs(600_000_000_000);
        expect(Object.values(player.combatBuffs).some((b) => b.typeHrid === '/buff_types/wisdom')).toBe(false);
    });

    test('an empty personal buff list is a no-op for both permanent and timed application', () => {
        const simulator = makeSimulator();
        const player = makeUnit();
        player.personalCombatBuffs = { buffs: [] };

        expect(() => simulator._applyPersonalPermanentCombatBuffs(player)).not.toThrow();
        expect(() => simulator._applyPersonalTimedCombatBuffs(player)).not.toThrow();
        expect(Object.keys(player.permanentBuffs)).toHaveLength(0);
    });

    test("PB-02/PB-07: two buffs with different lifetimes (10m / 20m) expire independently - neither steals the other's expiry", () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const player = makeUnit();
        player.personalCombatBuffs = {
            buffs: [
                {
                    buff: {
                        uniqueHrid: '/buff_uniques/personal_damage',
                        typeHrid: '/buff_types/damage',
                        ratioBoost: 0.08,
                    },
                    remainingDurationNs: 600_000_000_000, // 10 minutes
                },
                {
                    buff: {
                        uniqueHrid: '/buff_uniques/personal_attack_speed',
                        typeHrid: '/buff_types/attack_speed',
                        ratioBoost: 0.15,
                    },
                    remainingDurationNs: 1_200_000_000_000, // 20 minutes
                },
            ],
        };

        simulator._applyPersonalTimedCombatBuffs(player);

        const damageBuff = player.combatBuffs['/buff_uniques/personal_damage'];
        const speedBuff = player.combatBuffs['/buff_uniques/personal_attack_speed'];
        expect(damageBuff.duration).toBe(600_000_000_000);
        expect(speedBuff.duration).toBe(1_200_000_000_000);

        const times = simulator.eventQueue.minHeap.data.map((e) => e.time).sort((a, b) => a - b);
        expect(times).toEqual([600_000_000_000, 1_200_000_000_000]);

        // The shorter-lived buff expiring must not touch the longer-lived one (defect C's bug).
        player.removeExpiredBuffs(600_000_000_000);
        expect(player.combatBuffs['/buff_uniques/personal_damage']).toBeUndefined();
        expect(player.combatBuffs['/buff_uniques/personal_attack_speed']).toBeDefined();

        player.removeExpiredBuffs(1_200_000_000_000);
        expect(player.combatBuffs['/buff_uniques/personal_attack_speed']).toBeUndefined();
    });

    test('PB-03: reversed input order produces identical semantics (order-independent per-buff resolution)', () => {
        const makePlayerWithOrder = (buffs) => {
            const simulator = makeSimulator();
            simulator.simulationTime = 0;
            const player = makeUnit();
            player.personalCombatBuffs = { buffs };
            simulator._applyPersonalTimedCombatBuffs(player);
            return player;
        };

        const shortBuff = {
            buff: { uniqueHrid: '/buff_uniques/personal_damage', typeHrid: '/buff_types/damage', ratioBoost: 0.08 },
            remainingDurationNs: 600_000_000_000,
        };
        const longBuff = {
            buff: {
                uniqueHrid: '/buff_uniques/personal_attack_speed',
                typeHrid: '/buff_types/attack_speed',
                ratioBoost: 0.15,
            },
            remainingDurationNs: 1_200_000_000_000,
        };

        const forward = makePlayerWithOrder([shortBuff, longBuff]);
        const reversed = makePlayerWithOrder([longBuff, shortBuff]);

        expect(forward.combatBuffs['/buff_uniques/personal_damage'].duration).toBe(
            reversed.combatBuffs['/buff_uniques/personal_damage'].duration
        );
        expect(forward.combatBuffs['/buff_uniques/personal_attack_speed'].duration).toBe(
            reversed.combatBuffs['/buff_uniques/personal_attack_speed'].duration
        );
    });

    test('a mix of one permanent (no evidence) and one timed buff is split correctly by each applier', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const player = makeUnit();
        player.personalCombatBuffs = {
            buffs: [
                { buff: { typeHrid: '/buff_types/wisdom', flatBoost: 0.05 }, remainingDurationNs: null },
                { buff: { typeHrid: '/buff_types/damage', ratioBoost: 0.08 }, remainingDurationNs: 600_000_000_000 },
            ],
        };

        simulator._applyPersonalPermanentCombatBuffs(player);
        simulator._applyPersonalTimedCombatBuffs(player);

        expect(player.permanentBuffs['/buff_types/wisdom']).toBeDefined();
        expect(player.permanentBuffs['/buff_types/damage']).toBeUndefined();
        expect(Object.values(player.combatBuffs).some((b) => b.typeHrid === '/buff_types/damage')).toBe(true);
        expect(Object.values(player.combatBuffs).some((b) => b.typeHrid === '/buff_types/wisdom')).toBe(false);
    });
});

describe('CombatSimulator.simulate - strict horizon (TLA-039 HZN-01/02/03)', () => {
    // Zero players/enemies makes RegenTickEvent (every 10s) the only recurring event, giving a
    // fully deterministic event schedule with no combat RNG to isolate the horizon boundary itself.
    function makeEmptyZone() {
        return {
            hrid: '/actions/combat/test_zone',
            difficultyTier: 0,
            isDungeon: false,
            monsterSpawnInfo: {},
            getRandomEncounter() {
                return [];
            },
        };
    }

    test('HZN-02/HZN-03: an event exactly at the horizon is processed, and simulatedTime is the exact requested horizon', () => {
        const simulator = new CombatSimulator([], makeEmptyZone(), null, null);
        const result = simulator.simulate(20_000_000_000); // RegenTick fires at 0, 10s, 20s

        expect(simulator.simulationTime).toBe(20_000_000_000);
        expect(result.simulatedTime).toBe(20_000_000_000);
    });

    test('HZN-01: an event one ns past the horizon is never processed', () => {
        const simulator = new CombatSimulator([], makeEmptyZone(), null, null);
        const result = simulator.simulate(20_000_000_000 - 1);

        expect(simulator.simulationTime).toBe(10_000_000_000); // the 20s tick never ran
        expect(result.simulatedTime).toBe(20_000_000_000 - 1); // still the exact requested horizon
    });
});

describe('CombatSimulator.checkEncounterEnd - dungeon terminal accounting (TLA-039 HZN)', () => {
    function makeDungeonZone(maxWaves, encountersKilled) {
        return {
            isDungeon: true,
            encountersKilled,
            dungeonsCompleted: 0,
            dungeonsFailed: 0,
            dungeonSpawnInfo: { maxWaves },
        };
    }

    function makeAlivePlayer() {
        return { hrid: 'player1', combatDetails: { currentHitpoints: 100, combatStats: { combatDropQuantity: 0 } } };
    }

    function makeDeadEnemy() {
        return { combatDetails: { currentHitpoints: 0 }, experience: 0, experienceRate: 1, hrid: '/monsters/test' };
    }

    function seedWaveStart(simulator, waveName, startTime) {
        simulator.simResult.timeSpentAlive.push({
            name: waveName,
            timeSpentAlive: 0,
            spawnedAt: startTime,
            alive: true,
            count: 0,
        });
    }

    test('HZN-04/05/10: a final-wave kill counts the completion, drop context, and duration exactly once, immediately', () => {
        const simulator = makeSimulator();
        simulator.players = [makeAlivePlayer()];
        simulator.zone = makeDungeonZone(3, 4); // just killed wave 3 of 3; encountersKilled already advanced past it
        simulator.dungeonRunStartTime = 1_000_000_000; // run started at t=1s
        simulator.simulationTime = 5_000_000_000; // killed at t=5s
        simulator.justCompletedDungeonRun = false;
        seedWaveStart(simulator, '#3', 4_000_000_000);
        simulator.enemies = [makeDeadEnemy()];

        simulator.checkEncounterEnd();

        expect(simulator.zone.dungeonsCompleted).toBe(1);
        expect(simulator.zone.encountersKilled).toBe(1);
        expect(simulator.simResult.dungeonCompletionDropContext.count).toBe(1);
        expect(simulator.simResult.totalDungeonCompletionDuration).toBe(4_000_000_000); // 5s - 1s
        expect(simulator.justCompletedDungeonRun).toBe(true);
    });

    test('HZN-12: killing a non-final wave does not count a completion', () => {
        const simulator = makeSimulator();
        simulator.players = [makeAlivePlayer()];
        simulator.zone = makeDungeonZone(3, 2); // killed wave 1 of 3
        simulator.dungeonRunStartTime = 0;
        simulator.simulationTime = 2_000_000_000;
        simulator.justCompletedDungeonRun = false;
        seedWaveStart(simulator, '#1', 1_000_000_000);
        simulator.enemies = [makeDeadEnemy()];

        simulator.checkEncounterEnd();

        expect(simulator.zone.dungeonsCompleted).toBe(0);
        expect(simulator.zone.encountersKilled).toBe(2); // untouched, still mid-run
        expect(simulator.justCompletedDungeonRun).toBe(false);
    });

    test('HZN-11: a second checkEncounterEnd call with no new enemies never double-counts the same completion', () => {
        const simulator = makeSimulator();
        simulator.players = [makeAlivePlayer()];
        simulator.zone = makeDungeonZone(3, 4);
        simulator.dungeonRunStartTime = 1_000_000_000;
        simulator.simulationTime = 5_000_000_000;
        simulator.justCompletedDungeonRun = false;
        seedWaveStart(simulator, '#3', 4_000_000_000);
        simulator.enemies = [makeDeadEnemy()];

        simulator.checkEncounterEnd();
        expect(simulator.zone.dungeonsCompleted).toBe(1);

        // this.enemies is now null - a stray re-check must be a no-op, not a second completion.
        simulator.checkEncounterEnd();
        expect(simulator.zone.dungeonsCompleted).toBe(1);
    });

    test('HZN-07: a full-party wipe counts the failure immediately and resets wave progress, without waiting for the delayed restart', () => {
        const simulator = makeSimulator();
        const deadPlayer = { hrid: 'player1', combatDetails: { currentHitpoints: 0, combatStats: {} } };
        simulator.players = [deadPlayer];
        simulator.zone = makeDungeonZone(3, 2); // wiped partway through wave 1
        simulator.simulationTime = 3_000_000_000;
        simulator.enemies = [{ combatDetails: { currentHitpoints: 50 } }]; // an enemy is still alive

        simulator.checkEncounterEnd();

        expect(simulator.zone.dungeonsFailed).toBe(1);
        expect(simulator.zone.encountersKilled).toBe(1);
        expect(simulator.allPlayersDead).toBe(true);
        // The delayed restart event was still scheduled (existing behavior preserved) - the failure
        // above must not be double-counted when it eventually fires 3s later.
        expect(simulator.eventQueue.minHeap.data.some((e) => e.type === CombatStartEvent.type)).toBe(true);
    });
});

describe('CombatSimulator.startNewEncounter - dungeon run-start capture and post-completion restore (TLA-039 HZN)', () => {
    function makeDungeonZone(maxWaves) {
        return {
            isDungeon: true,
            encountersKilled: 1,
            dungeonsCompleted: 0,
            dungeonsFailed: 0,
            dungeonSpawnInfo: { maxWaves, fixedSpawnsMap: {} },
            monsterSpawnInfo: {},
            getNextWave() {
                const enemy = new CombatUnit();
                enemy.hrid = '/monsters/test';
                enemy.combatDetails.currentHitpoints = 1;
                this.encountersKilled++;
                return [enemy];
            },
        };
    }

    test('wave 1 of a fresh attempt captures the run start time and, if just completed, restores HP/MP to full', () => {
        const simulator = makeSimulator();
        simulator.zone = makeDungeonZone(3);
        simulator.simulationTime = 10_000_000_000;
        const player = makeUnit();
        player.combatDetails.currentHitpoints = 1;
        player.combatDetails.currentManapoints = 1;
        player.combatDetails.maxHitpoints = 500;
        player.combatDetails.maxManapoints = 200;
        simulator.players = [player];
        simulator.justCompletedDungeonRun = true;

        simulator.startNewEncounter();

        expect(simulator.dungeonRunStartTime).toBe(10_000_000_000);
        expect(player.combatDetails.currentHitpoints).toBe(500);
        expect(player.combatDetails.currentManapoints).toBe(200);
        expect(simulator.justCompletedDungeonRun).toBe(false);
    });

    test('a mid-run wave transition (encountersKilled !== 1) neither re-captures the run start time nor restores HP/MP', () => {
        const simulator = makeSimulator();
        simulator.zone = makeDungeonZone(3);
        simulator.zone.encountersKilled = 2; // mid-run
        simulator.simulationTime = 20_000_000_000;
        simulator.dungeonRunStartTime = 5_000_000_000; // set earlier, by wave 1's own start
        const player = makeUnit();
        player.combatDetails.currentHitpoints = 1;
        player.combatDetails.maxHitpoints = 500;
        simulator.players = [player];
        simulator.justCompletedDungeonRun = false;

        simulator.startNewEncounter();

        expect(simulator.dungeonRunStartTime).toBe(5_000_000_000); // untouched
        expect(player.combatDetails.currentHitpoints).toBe(1); // not restored
    });

    test('a wipe restart (justCompletedDungeonRun still false) does not grant a free HP/MP restore', () => {
        const simulator = makeSimulator();
        simulator.zone = makeDungeonZone(3);
        simulator.zone.encountersKilled = 1; // reset to 1 immediately at wipe-detection time
        simulator.simulationTime = 30_000_000_000;
        const player = makeUnit();
        player.combatDetails.currentHitpoints = 1;
        player.combatDetails.maxHitpoints = 500;
        simulator.players = [player];
        simulator.justCompletedDungeonRun = false;

        simulator.startNewEncounter();

        expect(simulator.dungeonRunStartTime).toBe(30_000_000_000); // new attempt's start time captured
        expect(player.combatDetails.currentHitpoints).toBe(1); // not restored - this was a wipe, not a clear
    });
});
