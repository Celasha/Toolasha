import { describe, expect, test, vi } from 'vitest';

const { calculateHousesCostByDomain } = vi.hoisted(() => ({ calculateHousesCostByDomain: vi.fn() }));
vi.mock('../../../utils/house-cost-calculator.js', () => ({ calculateHousesCostByDomain }));

import { calculateHouseScore } from './house-score.js';

describe('calculateHouseScore (TLA-041)', () => {
    test('sums combat and skilling domains independently into separate categories', () => {
        calculateHousesCostByDomain.mockImplementation((rooms, domain) =>
            domain === 'combat'
                ? { totalCost: 5_000_000, complete: true, breakdown: [{ name: 'Dojo', level: 3, cost: 5_000_000 }] }
                : { totalCost: 2_000_000, complete: true, breakdown: [{ name: 'Garden', level: 1, cost: 2_000_000 }] }
        );

        const result = calculateHouseScore({ profile: { characterHouseRoomMap: {} } });

        expect(result.combat.score).toBeCloseTo(5);
        expect(result.combat.breakdown).toEqual([{ name: 'Dojo 3', value: '5.0' }]);
        expect(result.skiller.score).toBeCloseTo(2);
        expect(result.skiller.breakdown).toEqual([{ name: 'Garden 1', value: '2.0' }]);
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
