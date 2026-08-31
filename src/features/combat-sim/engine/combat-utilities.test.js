import { describe, expect, test } from 'vitest';
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
