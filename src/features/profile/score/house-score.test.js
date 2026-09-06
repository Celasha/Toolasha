import { describe, expect, test, vi } from 'vitest';

const { calculateHousesCostByDomain } = vi.hoisted(() => ({ calculateHousesCostByDomain: vi.fn() }));
vi.mock('../../../utils/house-cost-calculator.js', () => ({ calculateHousesCostByDomain }));

import { calculateHouseScore } from './house-score.js';

describe('calculateHouseScore (TLA-041)', () => {
    test('sums combat and skilling domains independently into separate categories', () => {
        calculateHousesCostByDomain.mockImplementation((rooms, domain) =>
            domain === 'combat'
                ? {
                      totalCost: 5_000_000,
                      complete: true,
                      breakdown: [{ name: 'Dojo', level: 3, cost: 5_000_000, complete: true }],
                  }
                : {
                      totalCost: 2_000_000,
                      complete: true,
                      breakdown: [{ name: 'Garden', level: 1, cost: 2_000_000, complete: true }],
                  }
        );

        const result = calculateHouseScore({ profile: { characterHouseRoomMap: {} } });

        expect(result.combat.score).toBeCloseTo(5);
        expect(result.combat.breakdown).toEqual([{ name: 'Dojo 3', value: '5.0', complete: true, reason: null }]);
        expect(result.skiller.score).toBeCloseTo(2);
        expect(result.skiller.breakdown).toEqual([{ name: 'Garden 1', value: '2.0', complete: true, reason: null }]);
    });

    test('an incomplete domain propagates incompleteness to the category', () => {
        calculateHousesCostByDomain.mockReturnValue({ totalCost: 0, complete: false, breakdown: [] });

        const result = calculateHouseScore({ profile: { characterHouseRoomMap: {} } });
        expect(result.combat.complete).toBe(false);
        expect(result.skiller.complete).toBe(false);
    });

    test('missing profile data does not throw', () => {
        calculateHousesCostByDomain.mockReturnValue({ totalCost: 0, complete: true, breakdown: [] });
        expect(() => calculateHouseScore({})).not.toThrow();
    });
});

describe('calculateHouseScore - LB-04/LB-05: room-level completeness propagation', () => {
    test('LB-04: a complete room sibling does not receive "+" merely because another room is incomplete', () => {
        calculateHousesCostByDomain.mockImplementation((rooms, domain) =>
            domain === 'combat'
                ? {
                      totalCost: 5_000_000,
                      complete: false,
                      breakdown: [
                          { name: 'Dojo', level: 3, cost: 5_000_000, complete: true },
                          { name: 'Armory', level: 2, cost: 0, complete: false },
                      ],
                  }
                : { totalCost: 0, complete: true, breakdown: [] }
        );

        const result = calculateHouseScore({ profile: { characterHouseRoomMap: {} } });

        expect(result.combat.complete).toBe(false);
        const dojo = result.combat.breakdown.find((leaf) => leaf.name === 'Dojo 3');
        const armory = result.combat.breakdown.find((leaf) => leaf.name === 'Armory 2');
        expect(dojo).toEqual({ name: 'Dojo 3', value: '5.0', complete: true, reason: null });
        expect(armory).toEqual({ name: 'Armory 2', value: null, complete: false, reason: null });
    });

    test('LB-05: a partially-priceable room propagates room "+" -> House "+" -> (top handled by score-calculator)', () => {
        calculateHousesCostByDomain.mockReturnValue({
            totalCost: 55_000_000,
            complete: false,
            breakdown: [{ name: 'Observatory', level: 8, cost: 55_000_000, complete: false }],
        });

        const result = calculateHouseScore({ profile: { characterHouseRoomMap: {} } });

        expect(result.combat.complete).toBe(false);
        expect(result.combat.breakdown).toEqual([
            { name: 'Observatory 8', value: '55.0', complete: false, reason: null },
        ]);
    });

    test('an aggregate-level incompleteness with no representable room leaf still fails the category closed', () => {
        calculateHousesCostByDomain.mockReturnValue({ totalCost: 0, complete: false, breakdown: [] });

        const result = calculateHouseScore({ profile: { characterHouseRoomMap: {} } });
        expect(result.combat.complete).toBe(false);
    });
});
