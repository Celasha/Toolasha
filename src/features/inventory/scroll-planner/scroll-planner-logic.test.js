import { describe, it, expect } from 'vitest';
import {
    buildRun,
    getCurrentStep,
    getOwnedCount,
    getRemainingQuantity,
    getScrollHrids,
    isStepFinished,
    normalizePlan,
} from './scroll-planner-logic.js';

const itemDetailMap = {
    '/items/seal_of_gathering': { categoryHrid: '/item_categories/scroll', isOpenable: true, sortIndex: 2 },
    '/items/seal_of_damage': { categoryHrid: '/item_categories/scroll', isOpenable: true, sortIndex: 1 },
    '/items/bishops_scroll': { categoryHrid: '/item_categories/resource', isOpenable: false, sortIndex: 3 },
};
const SCROLLS = ['/items/seal_of_damage', '/items/seal_of_gathering'];

const inv = (itemHrid, count, extra = {}) => ({
    itemHrid,
    count,
    itemLocationHrid: '/item_locations/inventory',
    enhancementLevel: 0,
    ...extra,
});

describe('getScrollHrids', () => {
    it('returns only openable scroll-category items in game order', () => {
        expect(getScrollHrids(itemDetailMap)).toEqual(SCROLLS);
    });
    it('handles missing data', () => {
        expect(getScrollHrids(null)).toEqual([]);
    });
});

describe('getOwnedCount', () => {
    it('sums unenhanced inventory stacks only', () => {
        const items = [
            inv('/items/seal_of_damage', 4),
            inv('/items/seal_of_damage', 9, { itemLocationHrid: '/item_locations/equipment' }),
            inv('/items/seal_of_damage', 2, { enhancementLevel: 1 }),
        ];
        expect(getOwnedCount(items, '/items/seal_of_damage')).toBe(4);
    });
    it('is zero without items', () => {
        expect(getOwnedCount(null, '/items/seal_of_damage')).toBe(0);
    });
});

describe('normalizePlan', () => {
    it('drops unknown items, non-positive and non-numeric quantities, and floors decimals', () => {
        expect(
            normalizePlan(
                { '/items/seal_of_damage': 3.9, '/items/seal_of_gathering': 0, '/items/nope': 5, x: 'a' },
                SCROLLS
            )
        ).toEqual({ '/items/seal_of_damage': 3 });
    });
    it('tolerates garbage', () => {
        expect(normalizePlan(null, SCROLLS)).toEqual({});
        expect(normalizePlan('x', SCROLLS)).toEqual({});
    });
});

describe('buildRun', () => {
    it('clamps to owned, records shortfalls and orders by game order', () => {
        const items = [inv('/items/seal_of_gathering', 10), inv('/items/seal_of_damage', 2)];
        const { steps, shortfalls } = buildRun(
            { '/items/seal_of_gathering': 4, '/items/seal_of_damage': 5 },
            SCROLLS,
            items
        );
        expect(steps.map((s) => [s.itemHrid, s.quantity, s.targetCount])).toEqual([
            ['/items/seal_of_damage', 2, 0],
            ['/items/seal_of_gathering', 4, 6],
        ]);
        expect(shortfalls).toEqual([{ itemHrid: '/items/seal_of_damage', planned: 5, owned: 2 }]);
    });
    it('omits scrolls the character does not own', () => {
        const { steps, shortfalls } = buildRun({ '/items/seal_of_damage': 3 }, SCROLLS, []);
        expect(steps).toEqual([]);
        expect(shortfalls).toHaveLength(1);
    });
});

describe('run progress', () => {
    const items = [inv('/items/seal_of_damage', 5), inv('/items/seal_of_gathering', 5)];
    const { steps } = buildRun({ '/items/seal_of_damage': 2, '/items/seal_of_gathering': 3 }, SCROLLS, items);

    it('starts on the first step with the full quantity remaining', () => {
        const current = getCurrentStep(steps, items);
        expect(current.index).toBe(0);
        expect(getRemainingQuantity(current.step, items)).toBe(2);
    });
    it('finishes a step when the inventory reaches its target', () => {
        const after = [inv('/items/seal_of_damage', 3), inv('/items/seal_of_gathering', 5)];
        expect(isStepFinished(steps[0], after)).toBe(true);
        expect(getCurrentStep(steps, after).index).toBe(1);
    });
    it('shrinks the remaining quantity after a partial open', () => {
        const partial = [inv('/items/seal_of_damage', 4), inv('/items/seal_of_gathering', 5)];
        expect(getRemainingQuantity(steps[0], partial)).toBe(1);
    });
    it('treats a skipped step as finished and returns null when all are done', () => {
        const skipped = steps.map((s) => ({ ...s, skipped: true }));
        expect(getCurrentStep(skipped, items)).toBeNull();
    });
});
