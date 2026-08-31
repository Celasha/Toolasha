import { describe, expect, test } from 'vitest';
import CombatSimulator from './combat-simulator.js';
import CombatUnit from './combat-unit.js';

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

describe('CombatSimulator personal combat buff lifetime (CSIM-AUD-019)', () => {
    test('no expiry evidence keeps the personal buff permanent (status quo)', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const player = makeUnit();
        player.personalCombatBuffs = {
            buffs: [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 }],
            remainingDurationNs: null,
        };

        simulator._applyPersonalPermanentCombatBuffs(player);

        expect(player.permanentBuffs['/buff_types/wisdom'].flatBoost).toBeCloseTo(0.05);
        expect(simulator.eventQueue.minHeap.data).toHaveLength(0);
    });

    test('known remaining lifetime is modeled as a timed buff that expires on the simulation timeline, not permanently', () => {
        const simulator = makeSimulator();
        simulator.simulationTime = 0;
        const player = makeUnit();
        player.personalCombatBuffs = {
            buffs: [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 }],
            remainingDurationNs: 600_000_000_000, // 10 minutes in ns
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
        player.personalCombatBuffs = { buffs: [], remainingDurationNs: null };

        expect(() => simulator._applyPersonalPermanentCombatBuffs(player)).not.toThrow();
        expect(() => simulator._applyPersonalTimedCombatBuffs(player)).not.toThrow();
        expect(Object.keys(player.permanentBuffs)).toHaveLength(0);
    });
});
