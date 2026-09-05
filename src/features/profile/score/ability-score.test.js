import { describe, expect, test, vi } from 'vitest';

const { calculateAbilityBookCostDataDriven } = vi.hoisted(() => ({ calculateAbilityBookCostDataDriven: vi.fn() }));
vi.mock('../../../utils/ability-cost-calculator.js', () => ({ calculateAbilityBookCostDataDriven }));

import { calculateAbilityScore } from './ability-score.js';

describe('calculateAbilityScore (TLA-041)', () => {
    test('sums equipped abilities only, skipping unequipped/level-0 entries', () => {
        calculateAbilityBookCostDataDriven.mockReturnValue({ cost: 3_000_000, complete: true });

        const profileData = {
            profile: {
                equippedAbilities: [
                    { abilityHrid: '/abilities/fireball', level: 5 },
                    { abilityHrid: '/abilities/speed_aura', level: 0 }, // unequipped
                    { abilityHrid: null, level: 3 }, // malformed, skipped
                ],
            },
        };

        const result = calculateAbilityScore(profileData);
        expect(calculateAbilityBookCostDataDriven).toHaveBeenCalledTimes(1);
        expect(result.score).toBeCloseTo(3);
        expect(result.breakdown).toEqual([{ name: 'Fireball 5', value: '3.0' }]);
    });

    test('an unpriceable ability book propagates partial state (PB-39)', () => {
        calculateAbilityBookCostDataDriven.mockReturnValue({ cost: null, complete: false });

        const profileData = { profile: { equippedAbilities: [{ abilityHrid: '/abilities/fireball', level: 5 }] } };
        const result = calculateAbilityScore(profileData);

        expect(result.complete).toBe(false);
        expect(result.score).toBe(0);
    });

    test('missing profile data does not throw', () => {
        expect(() => calculateAbilityScore({})).not.toThrow();
    });
});
