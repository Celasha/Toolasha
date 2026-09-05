import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CombatUtilities from './combat-utilities.js';

function makePlayer(taskEligibleMonsterHrids, taskDamage = 0.15) {
    return {
        isPlayer: true,
        hrid: 'player1',
        taskEligibleMonsterHrids,
        combatDetails: { combatStats: { taskDamage } },
    };
}

function makeMonster(hrid, taskDamage = 0) {
    return {
        isPlayer: false,
        hrid,
        combatDetails: { combatStats: { taskDamage } },
    };
}

describe('CombatUtilities.getEffectiveTaskDamage (CSIM-AUD-023) - target-aware task eligibility', () => {
    test("active Monster task target receives the player's Task Damage", () => {
        const player = makePlayer(['/monsters/bear']);
        const monster = makeMonster('/monsters/bear');

        expect(CombatUtilities.getEffectiveTaskDamage(player, monster)).toBeCloseTo(0.15);
    });

    test('a different/non-task monster receives no Task Damage', () => {
        const player = makePlayer(['/monsters/bear']);
        const monster = makeMonster('/monsters/rat');

        expect(CombatUtilities.getEffectiveTaskDamage(player, monster)).toBe(0);
    });

    test('no active task at all means no Task Damage against anything', () => {
        const player = makePlayer([]);
        const monster = makeMonster('/monsters/bear');

        expect(CombatUtilities.getEffectiveTaskDamage(player, monster)).toBe(0);
    });

    test('multiple simultaneous active Monster tasks are all honored', () => {
        const player = makePlayer(['/monsters/bear', '/monsters/rat']);

        expect(CombatUtilities.getEffectiveTaskDamage(player, makeMonster('/monsters/bear'))).toBeCloseTo(0.15);
        expect(CombatUtilities.getEffectiveTaskDamage(player, makeMonster('/monsters/rat'))).toBeCloseTo(0.15);
        expect(CombatUtilities.getEffectiveTaskDamage(player, makeMonster('/monsters/wolf'))).toBe(0);
    });

    test("a manual/imported party member with unknown task context (empty array) stays neutral, never inherits another player's task", () => {
        const unknownTeammate = makePlayer(undefined, 0.15);
        unknownTeammate.taskEligibleMonsterHrids = [];
        const monster = makeMonster('/monsters/bear');

        expect(CombatUtilities.getEffectiveTaskDamage(unknownTeammate, monster)).toBe(0);
    });

    test('an enhanced Task Badge value (higher taskDamage) is preserved verbatim when eligible', () => {
        const player = makePlayer(['/monsters/bear'], 0.165); // Expert Task Badge + enhancement
        const monster = makeMonster('/monsters/bear');

        expect(CombatUtilities.getEffectiveTaskDamage(player, monster)).toBeCloseTo(0.165);
    });

    test('non-player units (monsters) return their own taskDamage stat unconditionally - no task concept for monsters', () => {
        const monsterSource = makeMonster('/monsters/bear', 0.2);
        const player = makePlayer(['/monsters/bear']);

        expect(CombatUtilities.getEffectiveTaskDamage(monsterSource, player)).toBeCloseTo(0.2);
    });
});

function makeCombatant(overrides = {}) {
    const { combatDetails: combatDetailsOverrides, combatStats: combatStatsOverrides, ...rest } = overrides;
    return {
        isPlayer: true,
        hrid: 'attacker',
        taskEligibleMonsterHrids: [],
        isWeakened: false,
        combatDetails: {
            currentHitpoints: 1_000_000,
            stabAccuracyRating: 1000,
            stabMaxDamage: 100,
            stabEvasionRating: 0,
            smashAccuracyRating: 0,
            smashEvasionRating: 1000, // never accidentally triggers a retaliation hit
            totalArmor: 0,
            defensiveMaxDamage: 0,
            ...combatDetailsOverrides,
            combatStats: {
                combatStyleHrid: '/combat_styles/stab',
                damageType: '/damage_types/physical',
                physicalAmplify: 0,
                armorPenetration: 0,
                criticalRate: 0,
                criticalDamage: 0,
                autoAttackDamage: 0,
                abilityDamage: 0,
                taskDamage: 0,
                damageTaken: 0,
                physicalThorns: 0,
                retaliation: 0,
                lifeSteal: 0,
                manaLeech: 0,
                ...combatStatsOverrides,
            },
        },
        ...rest,
    };
}

describe('CombatUtilities.processAttack - target-aware Task Damage on direct hits (TLA-039 TD)', () => {
    // randomInt is mocked to a fixed 100 so the primary damageRoll is deterministic regardless of
    // min/max spread (accuracy >> evasion guarantees a hit, criticalRate=0 guarantees no crit) -
    // isolating exactly the Task Damage multiplier under test from the roll's own randomness.
    beforeEach(() => {
        vi.spyOn(CombatUtilities, 'randomInt').mockReturnValue(100);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('TD-01: Task Damage = 0 is deterministic-equivalent to no multiplier applied at all', () => {
        const source = makeCombatant({ hrid: 'player1', taskEligibleMonsterHrids: [] });
        const target = makeCombatant({ hrid: '/monsters/bear' });

        const result = CombatUtilities.processAttack(source, target);

        expect(result.didHit).toBe(true);
        expect(result.damageDone).toBe(100);
    });

    test('TD-02: an eligible direct auto-attack hit gets the exact effective Task Damage multiplier', () => {
        const source = makeCombatant({
            hrid: 'player1',
            taskEligibleMonsterHrids: ['/monsters/bear'],
            combatStats: { taskDamage: 0.5 },
        });
        const target = makeCombatant({ hrid: '/monsters/bear' });

        const result = CombatUtilities.processAttack(source, target);

        expect(result.damageDone).toBe(150); // 100 * (1 + 0.5)
    });

    test('TD-03: same Task Damage stat against a non-eligible target applies no Task Damage', () => {
        const source = makeCombatant({
            hrid: 'player1',
            taskEligibleMonsterHrids: ['/monsters/bear'],
            combatStats: { taskDamage: 0.5 },
        });
        const target = makeCombatant({ hrid: '/monsters/rat' });

        const result = CombatUtilities.processAttack(source, target);

        expect(result.damageDone).toBe(100);
    });

    test('TD-04: a direct ability hit uses the same target-aware rule as auto-attacks', () => {
        const source = makeCombatant({
            hrid: 'player1',
            taskEligibleMonsterHrids: ['/monsters/bear'],
            combatStats: { taskDamage: 0.5 },
        });
        const target = makeCombatant({ hrid: '/monsters/bear' });
        const abilityEffect = {
            combatStyleHrid: '/combat_styles/stab',
            damageType: '/damage_types/physical',
            damageFlat: 0,
            damageRatio: 1,
            armorDamageRatio: 0,
            bonusAccuracyRatio: 0,
        };

        const result = CombatUtilities.processAttack(source, target, abilityEffect);

        expect(result.damageDone).toBe(150); // 100 * (1 + 0.5), same rule as auto-attacks
    });

    test('TD-05: an unknown/empty teammate task context (no taskEligibleMonsterHrids) stays neutral', () => {
        const source = makeCombatant({ hrid: 'player1', taskEligibleMonsterHrids: undefined });
        const target = makeCombatant({ hrid: '/monsters/bear' });

        const result = CombatUtilities.processAttack(source, target);

        expect(result.damageDone).toBe(100);
    });

    test('TD-06: an enhanced Task Badge value (higher taskDamage) is preserved exactly when eligible', () => {
        const source = makeCombatant({
            hrid: 'player1',
            taskEligibleMonsterHrids: ['/monsters/bear'],
            combatStats: { taskDamage: 0.165 }, // Expert Task Badge + enhancement
        });
        const target = makeCombatant({ hrid: '/monsters/bear' });

        const result = CombatUtilities.processAttack(source, target);

        expect(result.damageDone).toBe(Math.ceil(100 * 1.165));
    });

    test('TD-07: an eligible attacker still applies Task Damage only once - thorns math is independent, not double-stacked', () => {
        // The defender (target) has physicalThorns configured; that counter-hit calculation uses
        // getEffectiveTaskDamage(target, source), entirely independent of the primary damageRoll's
        // own getEffectiveTaskDamage(source, target) call a few lines earlier. Adding an unrelated
        // thorns setup on the target must not change the primary hit's own damageDone at all.
        const source = makeCombatant({
            hrid: 'player1',
            taskEligibleMonsterHrids: ['/monsters/bear'],
            combatStats: { taskDamage: 0.5 },
        });
        const target = makeCombatant({
            hrid: '/monsters/bear',
            isPlayer: false,
            combatDetails: { defensiveMaxDamage: 10 },
            combatStats: { taskDamage: 0.3, physicalThorns: 1 },
        });

        const result = CombatUtilities.processAttack(source, target);

        // Primary hit gets the attacker's own Task Damage exactly once, unaffected by the target's
        // unrelated thorns/task-damage configuration.
        expect(result.damageDone).toBe(150);
    });
});
