import { describe, expect, test } from 'vitest';
import { findManaFoods, foodRate, optimizeManaFood } from './mana-food-optimizer.js';

const NS = 1e9;
const itemDetailMap = {
    '/items/gummy': {
        consumableDetail: { manapointRestore: 40, cooldownDuration: 60 * NS },
        usableInActionTypeMap: { '/action_types/combat': true },
    },
    '/items/yogurt': {
        consumableDetail: { manapointRestore: 50, cooldownDuration: 60 * NS, recoveryDuration: 30 * NS },
    },
    '/items/star_yogurt': { consumableDetail: { manapointRestore: 350, cooldownDuration: 60 * NS } },
    '/items/cheese': { consumableDetail: { hitpointRestore: 100, manapointRestore: 0, cooldownDuration: 60 * NS } },
    '/items/skilling_only': {
        consumableDetail: { manapointRestore: 999, cooldownDuration: 60 * NS },
        usableInActionTypeMap: { '/action_types/combat': false },
    },
    '/items/rock': {},
};

describe('findManaFoods', () => {
    test('picks the items that restore mana in combat, with their restore and cooldown', () => {
        const foods = findManaFoods(itemDetailMap);

        expect(foods.map((food) => food.hrid)).toEqual(['/items/gummy', '/items/yogurt', '/items/star_yogurt']);
        expect(foods[0]).toEqual({ hrid: '/items/gummy', restore: 40, cooldownMs: 60000 });
    });

    test('copes with no data', () => {
        expect(findManaFoods(undefined)).toEqual([]);
    });
});

describe('foodRate', () => {
    test('is the restore per cooldown, and food haste shortens the cooldown', () => {
        const food = { restore: 350, cooldownMs: 60000 };

        expect(foodRate(food).perMinute).toBe(350);
        expect(foodRate(food).usesPerDay).toBe(1440);
        expect(foodRate(food, 0.1).perMinute).toBeCloseTo(385, 5);
        expect(foodRate(food, 0.1).usesPerDay).toBeCloseTo(1584, 5);
    });
});

describe('optimizeManaFood', () => {
    const foods = findManaFoods(itemDetailMap);
    // Per mana: gummy 10/mana-ish; star yogurt 3000 per use is 8.6/mana; yogurt 1000 per use is 20/mana
    const prices = { '/items/gummy': 400, '/items/yogurt': 1000, '/items/star_yogurt': 3000 };
    const priceOf = (hrid) => (prices[hrid] ? { price: prices[hrid] } : null);

    test('with one slot picks the cheapest single food that reaches the target', () => {
        const result = optimizeManaFood({ foods, priceOf, targetPerMinute: 300, slots: 1 });

        expect(result.reachable).toBe(true);
        expect(result.items.map((item) => item.hrid)).toEqual(['/items/star_yogurt']);
        expect(result.totalCostPerDay).toBe(1440 * 3000);
    });

    test('a small target takes the cheapest food, not the biggest', () => {
        const result = optimizeManaFood({ foods, priceOf, targetPerMinute: 30, slots: 1 });

        expect(result.items.map((item) => item.hrid)).toEqual(['/items/gummy']);
    });

    test('with two slots it can combine foods when that is cheaper than one big one', () => {
        const result = optimizeManaFood({ foods, priceOf, targetPerMinute: 90, slots: 2 });

        expect(result.items.map((item) => item.hrid).sort()).toEqual(['/items/gummy', '/items/yogurt']);
        expect(result.totalPerMinute).toBe(90);
    });

    test('says so when the target cannot be reached, and gives the most mana it can', () => {
        const result = optimizeManaFood({ foods, priceOf, targetPerMinute: 1000, slots: 2 });

        expect(result.reachable).toBe(false);
        expect(result.totalPerMinute).toBe(400);
        expect(result.deficit).toBe(600);
    });

    test('foods without a price are left out and reported', () => {
        const result = optimizeManaFood({
            foods,
            priceOf: (hrid) => (hrid === '/items/gummy' ? { price: 400 } : null),
            targetPerMinute: 30,
            slots: 2,
        });

        expect(result.items.map((item) => item.hrid)).toEqual(['/items/gummy']);
        expect(result.unpriced.sort()).toEqual(['/items/star_yogurt', '/items/yogurt']);
    });

    test('a food that restores more than the mana pool can hold is never used', () => {
        const result = optimizeManaFood({ foods, priceOf, targetPerMinute: 300, slots: 1, maxMana: 200 });

        expect(result.items.map((item) => item.hrid)).not.toContain('/items/star_yogurt');
        expect(result.reachable).toBe(false);
    });

    test('food haste raises what each slot gives', () => {
        const result = optimizeManaFood({ foods, priceOf, targetPerMinute: 380, slots: 1, foodHaste: 0.1 });

        expect(result.reachable).toBe(true);
    });

    test('no slots or no foods gives an empty answer', () => {
        expect(optimizeManaFood({ foods, priceOf, targetPerMinute: 10, slots: 0 })).toMatchObject({
            reachable: false,
            items: [],
        });
        expect(optimizeManaFood({ foods: [], priceOf, targetPerMinute: 10, slots: 2 }).items).toEqual([]);
    });

    test('flags an outlier price on the chosen food', () => {
        const result = optimizeManaFood({
            foods,
            priceOf: (hrid) => (hrid === '/items/gummy' ? { price: 400, isOutlier: true } : null),
            targetPerMinute: 30,
            slots: 1,
        });

        expect(result.items[0].isOutlier).toBe(true);
    });
});
