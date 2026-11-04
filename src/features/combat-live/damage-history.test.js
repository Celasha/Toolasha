import { describe, expect, test } from 'vitest';
import { DamageHistory, HISTORY_BUCKETS, smoothSeries } from './damage-history.js';

describe('smoothSeries', () => {
    test('is a rolling average over the last steps, shorter at the start', () => {
        expect(smoothSeries([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
    });

    test('keeps a lone spike from standing out', () => {
        const smoothed = smoothSeries([0, 0, 0, 80, 0, 0, 0, 0], 8);
        expect(Math.max(...smoothed)).toBe(20);
    });

    test('is empty for no data', () => {
        expect(smoothSeries([])).toEqual([]);
    });
});

describe('DamageHistory', () => {
    test('series is damage per second in each finished 2s step, ending at the last complete one', () => {
        const history = new DamageHistory();
        history.add('Alice', 100, 0);
        history.add('Alice', 100, 1500);
        history.add('Alice', 60, 2500);

        // At 6000ms the steps 0-2s, 2-4s and 4-6s are finished; the one in progress (6-8s) is not
        expect(history.series('Alice', 6000)).toEqual([100, 30, 0]);
    });

    test('does not count the step still in progress', () => {
        const history = new DamageHistory();
        history.add('Alice', 100, 0);
        history.add('Alice', 500, 2500);

        // The step holding the 500 (2-4s) is still running at 3s, so only the first step counts
        expect(history.series('Alice', 3000)).toEqual([50]);
    });

    test('keeps players apart, and someone who has done nothing is a flat line', () => {
        const history = new DamageHistory();
        history.add('Alice', 100, 0);
        history.add('Bob', 40, 0);

        expect(history.series('Bob', 4000)).toEqual([20, 0]);
        expect(history.series('Nobody', 4000)).toEqual([0, 0]);
        expect(new DamageHistory().series('Nobody', 4000)).toEqual([]);
    });

    test('starts when the fight did, with zeros for the quiet steps after it', () => {
        const history = new DamageHistory();
        history.add('Alice', 100, 10000);

        expect(history.series('Alice', 16000)).toEqual([50, 0, 0]);
    });

    test('never looks back more than five minutes', () => {
        const history = new DamageHistory();
        for (let t = 0; t < 700000; t += 2000) history.add('Alice', 20, t);

        expect(history.series('Alice', 700000)).toHaveLength(HISTORY_BUCKETS);
    });

    test('a long silence starts the series over', () => {
        const history = new DamageHistory();
        history.add('Alice', 100, 0);
        history.add('Alice', 100, 200000);

        expect(history.series('Alice', 206000)).toEqual([50, 0, 0]);
    });

    test('reset forgets everything', () => {
        const history = new DamageHistory();
        history.add('Alice', 100, 0);
        history.reset();

        expect(history.series('Alice', 10000)).toEqual([]);
    });
});

describe('DamageHistory boss steps', () => {
    test('marks the steps of a boss wave and not the ones around it', () => {
        const history = new DamageHistory();
        history.add('Alice', 10, 0);
        history.markBoss(false, 0);
        history.markBoss(true, 4000);
        history.markBoss(false, 8000);
        history.add('Alice', 10, 9000);

        // Steps 0-2s, 2-4s, 4-6s, 6-8s, 8-10s, then up to the last finished one at 12s
        expect(history.bossSeries(12000)).toEqual([false, false, true, true, false, false]);
    });

    test('is aligned with the series and empty before any damage', () => {
        const history = new DamageHistory();
        expect(history.bossSeries(10000)).toEqual([]);
        history.add('Alice', 10, 0);
        expect(history.bossSeries(10000)).toHaveLength(history.series('Alice', 10000).length);
    });

    test('ignores a repeat of the same flag', () => {
        const history = new DamageHistory();
        history.markBoss(true, 0);
        history.markBoss(true, 5000);

        expect(history.bossChanges).toHaveLength(1);
    });
});
