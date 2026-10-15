import { describe, expect, test } from 'vitest';
import { estimateKeyRunway, KEY_RUNWAY_WINDOW, KEY_RUNWAY_MIN_SAMPLES } from './dungeon-key-runway.js';

const MIN = 60 * 1000;

function clearsWith(durationsMs, startMs = Date.UTC(2026, 0, 1)) {
    // Oldest first: index i happened i minutes after the start.
    return durationsMs.map((duration, i) => ({ timestamp: new Date(startMs + i * MIN).toISOString(), duration }));
}

describe('estimateKeyRunway', () => {
    test('multiplies held keys by the average clear time', () => {
        const result = estimateKeyRunway(clearsWith([10 * MIN, 20 * MIN, 30 * MIN]), 4);
        expect(result.sampleSize).toBe(3);
        expect(result.seconds).toBe(20 * 60 * 4);
    });

    test('averages only the most recent clears, not the whole history', () => {
        const old = Array(50).fill(60 * MIN); // slow, old runs
        const recent = Array(KEY_RUNWAY_WINDOW).fill(10 * MIN); // newer, faster runs
        const result = estimateKeyRunway(clearsWith([...old, ...recent]), 6);
        expect(result.sampleSize).toBe(KEY_RUNWAY_WINDOW);
        expect(result.seconds).toBe(10 * 60 * 6);
    });

    test('is independent of input order and uses totalTime as a fallback', () => {
        const clears = clearsWith([10 * MIN, 20 * MIN, 30 * MIN]).reverse();
        clears[0] = { timestamp: clears[0].timestamp, totalTime: 30 * MIN };
        expect(estimateKeyRunway(clears, 1).seconds).toBe(20 * 60);
    });

    test('returns null with no keys', () => {
        expect(estimateKeyRunway(clearsWith(Array(5).fill(10 * MIN)), 0)).toBeNull();
        expect(estimateKeyRunway(clearsWith(Array(5).fill(10 * MIN)), undefined)).toBeNull();
    });

    test('returns null with too few usable clears', () => {
        const few = clearsWith(Array(KEY_RUNWAY_MIN_SAMPLES - 1).fill(10 * MIN));
        expect(estimateKeyRunway(few, 5)).toBeNull();
        expect(estimateKeyRunway(clearsWith([0, 0, 0, 0]), 5)).toBeNull();
    });
});
