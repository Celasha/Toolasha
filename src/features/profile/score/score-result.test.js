import { describe, expect, test } from 'vitest';

import { emptyCategory, attribute, mergeCategory } from './score-result.js';

describe('emptyCategory', () => {
    test('starts complete with zero score/unpricedCount and an empty breakdown', () => {
        expect(emptyCategory()).toEqual({ score: 0, complete: true, unpricedCount: 0, breakdown: [] });
    });
});

describe('attribute - lower-bound leaf provenance (TLA-041C / LB-01..03, LB-10, LB-11)', () => {
    test('a complete positive leaf adds to score and stays a plain numeric breakdown entry', () => {
        const category = emptyCategory();
        attribute(category, { name: 'Sword +10', cost: 700_000_000, complete: true });

        expect(category.score).toBeCloseTo(700);
        expect(category.complete).toBe(true);
        expect(category.unpricedCount).toBe(0);
        expect(category.breakdown).toEqual([{ name: 'Sword +10', value: '700.0', complete: true, reason: null }]);
    });

    test('LB-02: an unpriceable leaf stays visible as N/A instead of disappearing', () => {
        const category = emptyCategory();
        attribute(category, { name: 'Item B', cost: null, complete: false });

        expect(category.score).toBe(0);
        expect(category.complete).toBe(false);
        expect(category.unpricedCount).toBe(1);
        expect(category.breakdown).toEqual([{ name: 'Item B', value: null, complete: false, reason: null }]);
    });

    test('LB-03: a positive partial (incomplete) leaf renders a numeric value, not N/A', () => {
        const category = emptyCategory();
        attribute(category, { name: 'Observatory 8', cost: 55_000_000, complete: false });

        expect(category.score).toBeCloseTo(55);
        expect(category.complete).toBe(false);
        expect(category.breakdown[0]).toEqual({ name: 'Observatory 8', value: '55.0', complete: false, reason: null });
    });

    test('preserves an optional reason for an unpriceable leaf', () => {
        const category = emptyCategory();
        attribute(category, {
            name: 'Item B',
            cost: null,
            complete: false,
            reason: 'No complete acquisition route could be priced',
        });

        expect(category.breakdown[0].reason).toBe('No complete acquisition route could be priced');
    });

    test('LB-10: a fully complete category never gets a spurious incomplete leaf', () => {
        const category = emptyCategory();
        attribute(category, { name: 'A', cost: 10_000_000, complete: true });
        attribute(category, { name: 'B', cost: 20_000_000, complete: true });

        expect(category.complete).toBe(true);
        expect(category.unpricedCount).toBe(0);
        expect(category.breakdown.every((leaf) => leaf.complete)).toBe(true);
    });

    test('LB-11: a zero/negative cost never renders as a deceptive numeric 0 - it is N/A', () => {
        const category = emptyCategory();
        attribute(category, { name: 'Free Item', cost: 0, complete: true });

        expect(category.breakdown[0].value).toBeNull();
        expect(category.score).toBe(0);
    });

    test('one incomplete leaf marks the whole category incomplete without discarding complete siblings', () => {
        const category = emptyCategory();
        attribute(category, { name: 'Known', cost: 10_000_000, complete: true });
        attribute(category, { name: 'Unknown', cost: null, complete: false });

        expect(category.complete).toBe(false);
        expect(category.score).toBeCloseTo(10);
        expect(category.breakdown).toHaveLength(2);
    });
});

describe('mergeCategory', () => {
    test('sums scores, ANDs complete flags, sums unpricedCount, and concatenates breakdowns', () => {
        const a = {
            score: 10,
            complete: true,
            unpricedCount: 0,
            breakdown: [{ name: 'A', value: '10.0', complete: true, reason: null }],
        };
        const b = {
            score: 5,
            complete: false,
            unpricedCount: 1,
            breakdown: [{ name: 'B', value: null, complete: false, reason: null }],
        };

        const merged = mergeCategory([a, b]);
        expect(merged.score).toBeCloseTo(15);
        expect(merged.complete).toBe(false);
        expect(merged.unpricedCount).toBe(1);
        expect(merged.breakdown).toHaveLength(2);
    });

    test('sorts descending by numeric value with N/A (null value) leaves sinking to the bottom deterministically', () => {
        const category = emptyCategory();
        attribute(category, { name: 'Small', cost: 10_000_000, complete: true });
        attribute(category, { name: 'Unpriced', cost: null, complete: false });
        attribute(category, { name: 'Large', cost: 300_000_000, complete: true });

        const merged = mergeCategory([category]);
        expect(merged.breakdown.map((leaf) => leaf.name)).toEqual(['Large', 'Small', 'Unpriced']);
    });

    test('an empty parts list returns a fresh empty category', () => {
        expect(mergeCategory([])).toEqual(emptyCategory());
    });
});
